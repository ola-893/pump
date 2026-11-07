import type { EventMap, NearConnector } from '@hot-labs/near-connect';
import { testAccount } from '../../../near-demo/types.js';
import { rememberWalletAccount, rememberedWalletAccount, walletAccountKey, withWalletApproval } from './near-wallet-account.js';

type Connector = Pick<NearConnector, 'network' | 'getConnectedWallet' | 'connect' | 'disconnect' | 'on' | 'off'>;
type State = { account: string; accounts: string[]; busy: boolean; ready: boolean; error: string };
type Connection = { accounts: string[]; walletId: string };

// One account selection shared by registration, navigation and vault controls.
// Connection is account visibility only, not an ownership proof or trading grant.
export class NearWalletSession {
  private state: State = { account: '', accounts: [], busy: false, ready: false, error: '' };
  private listeners = new Set<() => void>();
  private revision = 0;
  private locked = false;
  private preferred = ''; 
  private connector: () => Promise<Connector>;
  constructor(connector: () => Promise<Connector>) {
    this.connector = connector;
    if (typeof window !== 'undefined') {
      try { this.preferred = window.localStorage.getItem('pump.near-testnet-account') ?? ''; } catch { /* Storage may be unavailable. */ }
    }
  }
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(next: Partial<State>) { this.state = { ...this.state, ...next }; this.listeners.forEach(fn => fn()); }
  private async account(c: Connector) {
    if (c.network !== 'testnet') throw new Error('Connect a NEAR testnet wallet.');
    const { accounts, wallet } = await c.getConnectedWallet();
    if (c.network !== 'testnet') throw new Error('Wallet network changed. Reconnect on NEAR testnet.');
    const valid = [...new Set(accounts.map(a => testAccount(a.accountId)))];
    if (!valid.length) throw new Error('No connected testnet accounts.');
    return {accounts:valid,walletId:wallet?.manifest.id ?? ''};
  }
  private select({accounts,walletId}: Connection, desired = this.preferred) {
    if (walletId==='meteor-wallet') desired=rememberedWalletAccount(walletId)||desired;
    const account = accounts.includes(desired) ? desired : accounts[0];
    this.preferred = account;
    this.update({ account, accounts });
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem('pump.near-testnet-account', account); } catch { /* Selection still works without storage. */ }
    }
  }
  selectAccount = async (desired: string) => {
    if (this.locked) return;
    this.locked = true;
    let revision = ++this.revision;
    this.update({ busy: true, error: '' });
    try {
      const c=await this.connector();
      let connection=await this.account(c);
      if (!connection.accounts.includes(desired)) throw new Error('This account is not connected to Pump.');
      if (connection.walletId==='meteor-wallet' && rememberedWalletAccount(connection.walletId)!==desired) {
        await withWalletApproval(()=>c.connect({walletId:connection.walletId}));
        revision=this.revision;
        connection=await this.account(c);
        if(revision!==this.revision)return;
        this.select(connection);
        if(this.state.account!==desired)throw new Error(`Meteor connected ${this.state.account}. Choose ${desired} in Meteor to switch accounts.`);
      } else if (revision === this.revision) this.select(connection, desired);
    } catch (e) {
      if (revision === this.revision) this.update({ error: e instanceof Error ? e.message : 'Account selection failed.' });
    } finally { this.locked = false; this.update({ busy: false }); }
  };
  start() {
    let active = true;
    let cleanup = () => {};
    const initial = ++this.revision;
    void this.connector().then(async c => {
      if (!active) return;
      const signedOut = () => { ++this.revision; this.update({ account: '', accounts: [], error: '' }); };
      const signedIn = (event?:EventMap['wallet:signIn']) => {
        const revision = ++this.revision;
        this.update({ account: '', accounts: [], error: '' });
        if(event?.accounts?.length && event.success){
          try{
            const account=testAccount(event.accounts[0].accountId);
            rememberWalletAccount(event.wallet.manifest.id,event.accounts);
            this.preferred=account;
          }catch(e){this.update({error:(e as Error).message});return;}
        }
        void this.account(c).then(accounts => {
          if (active && revision === this.revision) this.select(accounts);
        }).catch(e => {
          if (active && revision === this.revision) this.update({ account: '', error: e.message });
        });
      };
      c.on('wallet:signIn', signedIn);
      c.on('wallet:signOut', signedOut);
      const storedAccountChanged=(event:StorageEvent)=>{
        if(event.key!==walletAccountKey+'meteor-wallet')return;
        if(event.newValue===null){signedOut();return;}
        const revision=++this.revision;
        this.update({account:'',error:''});
        void this.account(c).then(connection=>{
          if(active&&revision===this.revision)this.select(connection);
        }).catch(e=>{if(active&&revision===this.revision)this.update({error:e.message});});
      };
      if(typeof window!=='undefined')window.addEventListener('storage',storedAccountChanged);
      cleanup = () => {
        c.off('wallet:signIn', signedIn); c.off('wallet:signOut', signedOut);
        if(typeof window!=='undefined')window.removeEventListener('storage',storedAccountChanged);
      };
      try {
        const accounts = await this.account(c);
        if (active && initial === this.revision) this.select(accounts);
      } catch { /* A disconnected wallet is a normal initial state. Never open a selector here. */ }
      finally { if (active) this.update({ ready: true }); }
    }).catch(() => { if (active) this.update({ ready: true }); });
    return () => { active = false; ++this.revision; cleanup(); };
  }
  connect = async () => {
    if (this.locked) return;
    this.locked = true;
    ++this.revision; // An earlier restoration must not replace this selection.
    this.update({ busy: true, error: '' });
    try {
      const c = await this.connector();
      if (c.network !== 'testnet') throw new Error('Connect a NEAR testnet wallet.');
      await withWalletApproval(()=>c.connect());
      const revision = ++this.revision;
      const accounts = await this.account(c);
      if (revision === this.revision) this.select(accounts);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not connect wallet.';
      this.update({ error: /reject|cancel/i.test(message) ? '' : message });
    } finally { this.locked = false; this.update({ busy: false, ready: true }); }
  };
  disconnect = async () => {
    if (this.locked) return;
    this.locked = true;
    ++this.revision;
    this.update({ busy: true, error: '' });
    try { await withWalletApproval(async()=>{await (await this.connector()).disconnect();}); this.update({ account: '', accounts: [] }); }
    catch (e) { this.update({ error: e instanceof Error ? e.message : 'Could not disconnect wallet.' }); }
    finally { this.locked = false; this.update({ busy: false }); }
  };
}
