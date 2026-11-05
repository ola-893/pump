import type { NearConnector } from '@hot-labs/near-connect';
import { testAccount } from '../../../near-demo/types.js';

type Connector = Pick<NearConnector, 'network' | 'getConnectedWallet' | 'connect' | 'disconnect' | 'on' | 'off'>;
type State = { account: string; accounts: string[]; busy: boolean; ready: boolean; error: string };

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
    const { accounts } = await c.getConnectedWallet();
    if (c.network !== 'testnet') throw new Error('Wallet network changed. Reconnect on NEAR testnet.');
    const valid = [...new Set(accounts.map(a => testAccount(a.accountId)))];
    if (!valid.length) throw new Error('No connected testnet accounts.');
    return valid;
  }
  private select(accounts: string[], desired = this.preferred) {
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
    const revision = ++this.revision;
    this.update({ busy: true, error: '' });
    try {
      const accounts = await this.account(await this.connector());
      if (!accounts.includes(desired)) throw new Error('This account is not connected to Pump.');
      if (revision === this.revision) this.select(accounts, desired);
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
      const signedIn = () => {
        const revision = ++this.revision;
        this.update({ account: '', accounts: [], error: '' });
        void this.account(c).then(accounts => {
          if (active && revision === this.revision) this.select(accounts);
        }).catch(e => {
          if (active && revision === this.revision) this.update({ account: '', error: e.message });
        });
      };
      c.on('wallet:signIn', signedIn);
      c.on('wallet:signOut', signedOut);
      cleanup = () => { c.off('wallet:signIn', signedIn); c.off('wallet:signOut', signedOut); };
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
      await c.connect();
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
    try { await (await this.connector()).disconnect(); this.update({ account: '', accounts: [] }); }
    catch (e) { this.update({ error: e instanceof Error ? e.message : 'Could not disconnect wallet.' }); }
    finally { this.locked = false; this.update({ busy: false }); }
  };
}
