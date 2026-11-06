import { useSyncExternalStore } from 'react';

export const hostedApp = import.meta.env.VITE_PUMP_HOSTED === '1';
const origin = 'http://127.0.0.1:5197';
const storageKey = 'pump.local-runner-session';
let token = '';
try { const saved = sessionStorage.getItem(storageKey); if (saved && /^[a-f0-9]{64}$/.test(saved)) token = saved; } catch { /* In-memory sessions still work. */ }
let state = { connected: !hostedApp || !!token, connecting: false, error: '' };
const listeners = new Set<() => void>();
const update = (next: Partial<typeof state>) => { state = { ...state, ...next }; listeners.forEach(fn => fn()); };
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
let cancelPairing: (() => void) | undefined;
function remember(value: string) { token = value; try { if (value) sessionStorage.setItem(storageKey, value); else sessionStorage.removeItem(storageKey); } catch { /* In-memory sessions still work. */ } }
export function connectRunner() {
  cancelPairing?.();
  const challenge = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
  const popup = window.open(`${origin}/api/near-demo/connect?state=${challenge}`, 'pump-local-runner', 'popup,width=640,height=620');
  if (!popup) { update({ error: 'Allow the connection window to open, then try again.' }); return; }
  update({ connecting: true, error: '' });
  const cleanup = () => { window.removeEventListener('message', receive); window.clearInterval(watch); cancelPairing = undefined; };
  const receive = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== popup || event.data?.type !== 'pump-runner-connected' || event.data?.state !== challenge || !/^[a-f0-9]{64}$/.test(event.data?.token)) return;
    remember(event.data.token); cleanup(); popup.close(); update({ connected: true, connecting: false, error: '' });
  };
  const expires = Date.now() + 5 * 60 * 1000;
  const watch = window.setInterval(() => { if (popup.closed || Date.now() > expires) { cleanup(); update({ connecting: false, error: popup.closed ? '' : 'Connection window expired. Try again.' }); } }, 1000);
  window.addEventListener('message', receive);
  cancelPairing = () => { cleanup(); popup.close(); update({ connecting: false }); };
}
export function cancelRunnerConnection() { cancelPairing?.(); }
export async function disconnectRunner() {
  const old = token;
  remember(''); update({ connected: false, connecting: false, error: '' });
  try { await fetch(origin + '/api/near-demo/bridge-disconnect', { method: 'POST', headers: { 'X-Pumpcoin-Demo-Token': old }, credentials: 'omit' }); } catch { /* A stopped runner already invalidates the session. */ }
}
export async function runnerFetch(path: string, init?: RequestInit) {
  if (!hostedApp) return fetch('/api/near-demo' + path, init);
  if (!token) throw new Error('Connect your local runner to use your agents.');
  const headers = new Headers(init?.headers);
  headers.set('X-Pumpcoin-Demo-Token', token);
  let response: Response;
  try { response = await fetch(origin + '/api/near-demo' + path, { ...init, headers, credentials: 'omit' }); }
  catch { throw new Error('Cannot reach your local runner. Start npm run runner and allow local network access in your browser.'); }
  if (response.status === 403) { remember(''); update({ connected: false, error: 'Your runner connection expired. Connect again.' }); }
  return response;
}
export function useLocalRunner() { return useSyncExternalStore(subscribe, () => state, () => state); }
