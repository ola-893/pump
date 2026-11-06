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
    const app = document.getElementById('root');
    if (!app) return;
    let dialog: HTMLElement | undefined;
    let returnFocus: HTMLElement | undefined;
    const initialInert = app.inert;
    const rememberFocus = (event: Event) => {
      if (!dialog && event.target instanceof HTMLElement) returnFocus = event.target;
    };
    const sync = () => {
      const next = [...document.querySelectorAll<HTMLElement>('.hot-connector-popup .modal-content')]
        .filter(element => element.getClientRects().length > 0).at(-1);
      if (next === dialog) return;
      dialog = next;
      app.inert = initialInert || !!dialog;
      if (!dialog) { returnFocus?.focus(); return; }
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', dialog.querySelector('.modal-header p')?.textContent?.trim() || 'NEAR wallet');
      dialog.tabIndex = -1;
      for (const option of dialog.querySelectorAll<HTMLElement>('.connect-item')) {
        option.setAttribute('role', 'button');
        option.tabIndex = 0;
      }
      dialog.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (!dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        dialog.closest<HTMLElement>('.modal-container')?.click();
      } else if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, iframe, [tabindex]')]
          .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length);
        if (!controls.length) { event.preventDefault(); return; }
        const current = controls.indexOf(document.activeElement as HTMLElement);
        const next = current < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : current + (event.shiftKey ? -1 : 1);
        event.preventDefault();
        controls[(next + controls.length) % controls.length].focus();
      } else if ((event.key === 'Enter' || event.key === ' ') &&
          event.target instanceof HTMLElement && event.target.matches('.connect-item')) {
        event.preventDefault();
        event.target.click();
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    app.addEventListener('focusin', rememberFocus);
    window.addEventListener('keydown', onKey, true);
    sync();
    return () => {
      observer.disconnect();
      app.inert = initialInert;
      app.removeEventListener('focusin', rememberFocus);
      window.removeEventListener('keydown', onKey, true);
    };
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
