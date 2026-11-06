import { base58 } from '@scure/base';
import { canonical } from '../../../near-demo/paper-state.js';
import type { JournalBatch, JournalListing, JournalPage } from '../../../near-demo/directory/public-journal.js';

const root = '/api/pump-directory';
type Publisher = { publicKey: string; signingKey: CryptoKey; authorized: boolean };

export async function journalRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(root + path, body === undefined ? undefined : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'The public journal service is unavailable.');
  return result;
}

export function readJournal(agentId: string, strategyId?: string, before?: number) {
  const query = new URLSearchParams();
  if (strategyId) query.set('strategy', strategyId);
  if (before !== undefined) query.set('before', String(before));
  return journalRequest<JournalPage>(`/journals/${encodeURIComponent(agentId)}?${query}`);
}

export function readJournalCatalog(offset = 0) {
  return journalRequest<{ agents: JournalListing[]; nextOffset: number | null }>(`/journal-agents?offset=${offset}`);
}

async function publisherStore(owner: string, publisher?: Publisher): Promise<Publisher | undefined> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open('pump-journal-publishers', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('keys');
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('keys', publisher ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('keys');
      const request = publisher ? store.put(publisher, owner) : store.get(owner);
      transaction.oncomplete = () => resolve(publisher ?? request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

type WalletChallenge = { id: string; account: string; message: string; recipient: string; nonce: string };

export async function authorizeJournalPublisher(owner: string, connectedAccount: string, sign: (challenge: WalletChallenge) => Promise<unknown>) {
  if (!connectedAccount || connectedAccount !== owner) throw new Error('Connect the registered owner’s NEAR testnet wallet.');
  return navigator.locks.request(`pump-public-journal-key:${owner}`, async () => {
    let publisher = await publisherStore(owner);
    if (publisher?.authorized) return publisher;
    if (!publisher) {
      const keys = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
      publisher = { publicKey: `ed25519:${base58.encode(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)))}`,
        signingKey: keys.privateKey, authorized: false };
      await publisherStore(owner, publisher);
    }
    const challenge = await journalRequest<WalletChallenge>('/challenge',
      { account: owner, runnerKey: publisher.publicKey, action: 'grant' });
    if (challenge.account !== owner) throw new Error('The publisher challenge belongs to another account.');
    const signed = await sign(challenge);
    await journalRequest('/authorize', { id: challenge.id, signed });
    publisher.authorized = true;
    await publisherStore(owner, publisher);
    return publisher;
  });
}

export async function sendJournalBatch(batch: JournalBatch) {
  const publisher = await publisherStore(batch.agent.controller);
  if (!publisher?.authorized) throw new Error('Authorize this browser to publish public journals.');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('PUMP-DIRECTORY-UPDATE-v1\0' + canonical(batch)));
  const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', publisher.signingKey, hash));
  return journalRequest<{ head: number }>('/journal-publish', {
    batch, publicKey: publisher.publicKey, signature: btoa(String.fromCharCode(...signature)),
  });
}
