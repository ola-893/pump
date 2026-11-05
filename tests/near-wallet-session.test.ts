import test from 'node:test';
import assert from 'node:assert/strict';
import { NearWalletSession } from '../app/src/lib/near-wallet-session.js';

class WalletFixture {
  network = 'testnet';
  accounts = [{ accountId: 'alice.testnet' }];
  connectCalls = 0;
  rejectConnect = false;
  listeners = new Map<string, Set<() => void>>();
  async getConnectedWallet() { return { accounts: this.accounts }; }
  async connect() { ++this.connectCalls; if (this.rejectConnect) throw new Error('User rejected'); this.emit('wallet:signIn'); }
  async disconnect() { this.accounts = []; this.emit('wallet:signOut'); }
  on(event: string, fn: () => void) { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event)!.add(fn); }
  off(event: string, fn: () => void) { this.listeners.get(event)?.delete(fn); }
  emit(event: string) { this.listeners.get(event)?.forEach(fn => fn()); }
}
function session(wallet: WalletFixture) {
  return new NearWalletSession(async () => wallet as unknown as Awaited<ReturnType<ConstructorParameters<typeof NearWalletSession>[0]>>);
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('restores an existing wallet without initiating a new sign-in', async () => {
  const wallet = new WalletFixture(), state = session(wallet), stop = state.start();
  await tick();
  assert.equal(state.snapshot().account, 'alice.testnet');
  assert.equal(state.snapshot().ready, true);
  assert.equal(wallet.connectCalls, 0);
  stop();
  assert.ok([...wallet.listeners.values()].every(listeners => listeners.size === 0));
});
test('account changes and disconnect invalidate the shared selection', async () => {
  const wallet = new WalletFixture(), state = session(wallet), stop = state.start();
  await tick();
  wallet.accounts = [{ accountId: 'bob.testnet' }]; wallet.emit('wallet:signIn');
  assert.equal(state.snapshot().account, '');
  await tick(); assert.equal(state.snapshot().account, 'bob.testnet');
  await state.disconnect();
  assert.equal(state.snapshot().account, '');
  assert.equal(state.snapshot().busy, false); stop();
});
test('a late restoration cannot overwrite a newly selected account', async () => {
  const wallet = new WalletFixture();
  let resolve!: (value: { accounts: { accountId: string }[] }) => void;
  let calls = 0;
  wallet.getConnectedWallet = async () => ++calls === 1 ? new Promise(r => { resolve = r; }) : { accounts: [{ accountId: 'bob.testnet' }] };
  const state = session(wallet), stop = state.start(); await tick();
  await state.connect(); assert.equal(state.snapshot().account, 'bob.testnet');
  resolve({ accounts: [{ accountId: 'alice.testnet' }] }); await tick();
  assert.equal(state.snapshot().account, 'bob.testnet'); stop();
});
test('mainnet and malformed account selections never become registration defaults', async () => {
  for (const [network, accountId] of [['mainnet', 'alice.near'], ['testnet', 'nearcom:0x123']]) {
    const wallet = new WalletFixture(); wallet.network = network; wallet.accounts = [{ accountId }];
    const state = session(wallet), stop = state.start(); await tick(); await state.connect();
    assert.equal(state.snapshot().account, ''); assert.ok(state.snapshot().error); stop();
  }
});
test('cancelled sign-in clears busy state and permits a later connection', async () => {
  const wallet = new WalletFixture(); wallet.accounts = []; wallet.rejectConnect = true;
  const state = session(wallet), stop = state.start(); await tick(); await state.connect();
  assert.equal(state.snapshot().account, ''); assert.equal(state.snapshot().busy, false);
  assert.equal(state.snapshot().error, '');
  wallet.rejectConnect = false; wallet.accounts = [{ accountId: 'alice.testnet' }]; await state.connect();
  assert.equal(state.snapshot().account, 'alice.testnet'); assert.equal(state.snapshot().error, ''); stop();
});
test('an account read in flight cannot undo a sign-out', async () => {
  const wallet = new WalletFixture();
  let resolve!: (value: { accounts: { accountId: string }[] }) => void;
  wallet.getConnectedWallet = async () => new Promise(r => { resolve = r; });
  const state = session(wallet), stop = state.start(); await tick();
  wallet.emit('wallet:signOut'); resolve({ accounts: [{ accountId: 'alice.testnet' }] }); await tick();
  assert.equal(state.snapshot().account, ''); stop();
});

test('users can select only a currently connected account and selection survives sign-in refresh',async()=>{
 const wallet=new WalletFixture();wallet.accounts=[{accountId:'alice.testnet'},{accountId:'bob.testnet'}];
 const state=session(wallet),stop=state.start();await tick();
 assert.deepEqual(state.snapshot().accounts,['alice.testnet','bob.testnet']);
 await state.selectAccount('bob.testnet');assert.equal(state.snapshot().account,'bob.testnet');
 wallet.emit('wallet:signIn');await tick();assert.equal(state.snapshot().account,'bob.testnet');
 await state.selectAccount('stranger.testnet');assert.equal(state.snapshot().account,'bob.testnet');assert.match(state.snapshot().error,/not connected/);
 wallet.accounts=[{accountId:'alice.testnet'}];wallet.emit('wallet:signIn');await tick();assert.equal(state.snapshot().account,'alice.testnet');
 stop();
});
