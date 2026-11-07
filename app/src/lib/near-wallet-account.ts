import type { Account, NearConnector, NearWalletBase } from '@hot-labs/near-connect';
import { testAccount } from '../../../near-demo/types.js';

export const walletAccountKey = 'pump.near-testnet-wallet-signer:';
const fallbackAccounts = new Map<string, string>();

export function rememberedWalletAccount(walletId: string) {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(walletAccountKey + walletId) ?? '';
  } catch { /* An in-memory connection still works when storage is unavailable. */ }
  return fallbackAccounts.get(walletId) ?? '';
}

export function rememberWalletAccount(walletId: string, accounts: Account[]) {
  if (walletId !== 'meteor-wallet') return;
  const account = accounts[0] ? testAccount(accounts[0].accountId) : '';
  fallbackAccounts.set(walletId, account);
  try {
    if (typeof localStorage !== 'undefined') {
      if (account) localStorage.setItem(walletAccountKey + walletId, account);
      else localStorage.removeItem(walletAccountKey + walletId);
    }
  } catch { /* Keep the connection in memory. */ }
}

export async function withWalletApproval<T>(action: () => Promise<T>): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return action();
  return await navigator.locks.request('pump-near-wallet-approval', { ifAvailable: true }, lock => {
    if (!lock) throw new Error('Another wallet approval is open. Finish it before trying again.');
    return action();
  });
}

/** Meteor signs with its sign-in account, even when another connected signerId is supplied. */
export async function withAccountWallet<T>(connector: NearConnector, account: string, action: (wallet: NearWalletBase) => Promise<T>) {
  testAccount(account);
  return withWalletApproval(async () => {
    if (connector.network !== 'testnet') throw new Error('Connect a NEAR testnet wallet.');
    let wallet = await connector.wallet();
    if (wallet.manifest.id === 'meteor-wallet' && rememberedWalletAccount(wallet.manifest.id) !== account) {
      await connector.connect({ walletId: wallet.manifest.id });
      wallet = await connector.wallet();
      if (rememberedWalletAccount(wallet.manifest.id) !== account)
        throw new Error(`Connect ${account} in Meteor to approve this action.`);
    }
    const accounts = await wallet.getAccounts({ network: 'testnet' });
    if (connector.network !== 'testnet' || !accounts.some(item => item.accountId === account))
      throw new Error('Wallet account or network changed. Reconnect.');
    return action(wallet);
  });
}
