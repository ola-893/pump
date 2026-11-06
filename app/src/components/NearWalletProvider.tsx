import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Wallet, LogOut } from 'lucide-react';
import { nearConnector } from '../lib/near-demo-wallet';
import { NearWalletSession } from '../lib/near-wallet-session';
import './NearWallet.css';

const Context = createContext<NearWalletSession | null>(null);
export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new NearWalletSession(nearConnector));
  useEffect(() => session.start(), [session]);
  useEffect(() => {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Use the connector's normal cancellation handler, including promise cleanup.
      const overlay = document.querySelector<HTMLElement>('.hot-connector-popup .modal-container');
      if (overlay?.getClientRects().length) { event.preventDefault(); overlay.click(); }
    };
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useNearWallet() {
  const session = useContext(Context);
  if (!session) throw new Error('NEAR wallet provider is missing.');
  const state = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  return { ...state, connect: session.connect, disconnect: session.disconnect, selectAccount: session.selectAccount };
}
export function NearWalletButton() {
  const { account, accounts, busy, ready, error, connect, disconnect, selectAccount } = useNearWallet();
  const short = account.length > 23 ? `${account.slice(0,12)}…${account.slice(-8)}` : account;
  return <div className="nw-wallet">
    {account ? <details className="nw-account" key={account}>
      <summary className="nd-button secondary" title={account}><Wallet size={15}/>{short}</summary>
      <div className="nw-menu"><span className="nd-eyebrow">NEAR TESTNET</span><strong>{account}</strong>
        {accounts.length > 1 && <label>Active account<select aria-label="Active NEAR testnet account" value={account} disabled={busy} onChange={event => void selectAccount(event.target.value)}>{accounts.map(id => <option key={id} value={id}>{id}</option>)}</select></label>}
        <button type="button" className="nd-text-button" disabled={busy} onClick={() => void connect()}>Change wallet</button>
        <button type="button" className="nd-button secondary" disabled={busy} onClick={() => void disconnect()}><LogOut size={14}/>Disconnect</button>
      </div>
    </details> : <button type="button" className="nd-button secondary" disabled={busy || !ready} onClick={() => void connect()}><Wallet size={15}/>{busy ? 'Connecting…' : !ready ? 'Loading wallet…' : 'Connect wallet'}</button>}
    {error && <span className="nw-error" role="alert">{error}</span>}
  </div>;
}
