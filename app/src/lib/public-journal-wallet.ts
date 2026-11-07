import { authorizeJournalPublisher } from './public-journal-client';
import { nearConnector } from './near-demo-wallet';
import { withAccountWallet } from './near-wallet-account';

export function authorizeWithOwnerWallet(owner: string, connected: string) {
  return authorizeJournalPublisher(owner, connected, async challenge => {
    return withAccountWallet(await nearConnector(),owner,wallet=>wallet.signMessage({ signerId: owner, network: 'testnet', message: challenge.message,
      recipient: challenge.recipient, nonce: Uint8Array.from(atob(challenge.nonce), byte => byte.charCodeAt(0)) }));
  });
}
