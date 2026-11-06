import { authorizeJournalPublisher } from './public-journal-client';
import { nearConnector } from './near-demo-wallet';

export function authorizeWithOwnerWallet(owner: string, connected: string) {
  return authorizeJournalPublisher(owner, connected, async challenge => {
    const wallet = await (await nearConnector()).wallet();
    return wallet.signMessage({ signerId: owner, network: 'testnet', message: challenge.message,
      recipient: challenge.recipient, nonce: Uint8Array.from(atob(challenge.nonce), byte => byte.charCodeAt(0)) });
  });
}
