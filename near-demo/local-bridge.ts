import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { allowedRequest } from './local-origin.js';

// A local, visible approval grants one browser tab access to this runner.
// No keys, model files, or control endpoints are exposed by the cloud service.
export class LocalBridge {
  private readonly pairing = randomBytes(32).toString('hex');
  private grants = new Map<string, number>();
  readonly origin: string | undefined;
  constructor(origin = process.env.PUMP_APP_ORIGIN) {
    if (origin) {
      const u = new URL(origin);
      if (u.protocol !== 'https:' || u.origin !== origin) throw new Error('PUMP_APP_ORIGIN must be an exact HTTPS origin.');
      this.origin = origin;
    }
  }
  private loopback(req: IncomingMessage) { return allowedRequest({ socket: req.socket, headers: { host: req.headers.host } }); }
  authorized(req: IncomingMessage) {
    const key = req.headers['x-pumpcoin-demo-token'];
    return !!this.origin && req.headers.origin === this.origin && this.loopback(req) &&
      typeof key === 'string' && (this.grants.get(key) ?? 0) > Date.now();
  }
  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = req.url?.split('?')[0];
    if (!req.url?.startsWith('/api/near-demo/')) return false;
    if (this.origin && req.headers.origin === this.origin && this.loopback(req)) {
      res.setHeader('Access-Control-Allow-Origin', this.origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        if (path === '/api/near-demo/bridge-grant') { this.json(res, 403, { error: 'Approve in the local runner window.' }); return true; }
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Pumpcoin-Demo-Token',
          'Access-Control-Allow-Private-Network': 'true' });
        res.end(); return true;
      }
    }
    if (path === '/api/near-demo/connect' && req.method === 'GET') {
      if (!this.origin || !this.loopback(req)) { this.json(res, 403, { error: 'Start npm run runner to connect the hosted app.' }); return true; }
      const state = new URL(req.url!, 'http://localhost').searchParams.get('state');
      if (!state || !/^[a-f0-9]{32}$/.test(state)) { this.json(res, 400, { error: 'Open this window using Connect local runner in Pump.' }); return true; }
      const nonce = randomBytes(16).toString('hex');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'` });
      res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect your Pump runner</title><style nonce="${nonce}">body{background:#10150e;color:#ecf5e7;font:16px system-ui;max-width:540px;margin:60px auto;padding:24px}h1{font-size:30px}p{line-height:1.6}strong{overflow-wrap:anywhere}button{background:#b3ef81;color:#10150e;border:0;border-radius:8px;padding:14px 20px;font:inherit;cursor:pointer}small{color:#b6c5ac}</style><h1>Connect your local runner</h1><p>Allow <strong id="origin"></strong> to create agents, read your local workspace, and run paper decisions using models on this computer?</p><p>Wallet signatures and testnet transactions still require separate wallet approval. This connection expires after eight hours or when the runner restarts.</p><button id="approve">Connect this browser tab</button><p id="status" role="status"></p><small>Only approve a Pump tab you opened. Close this window to cancel.</small><script nonce="${nonce}">const origin=${JSON.stringify(this.origin)};document.getElementById('origin').textContent=origin;document.getElementById('approve').onclick=async()=>{const button=document.getElementById('approve');button.disabled=true;try{if(!window.opener)throw Error('Open this window from the Pump app.');const response=await fetch('/api/near-demo/bridge-grant',{method:'POST',headers:{'Content-Type':'application/json','X-Pump-Bridge-Pairing':${JSON.stringify(this.pairing)}},body:'{}'});const data=await response.json();if(!response.ok)throw Error(data.error);window.opener.postMessage({type:'pump-runner-connected',state:${JSON.stringify(state)},token:data.token},origin);document.getElementById('status').textContent='Connected. Return to your Pump tab.';button.textContent='Connected';}catch(error){document.getElementById('status').textContent=error.message;button.disabled=false;}};</script></html>`);
      return true;
    }
    if (path === '/api/near-demo/bridge-grant') {
      if (!this.origin || req.method !== 'POST' || !allowedRequest(req) || req.headers.origin !== `http://${req.headers.host}` || req.headers['x-pump-bridge-pairing'] !== this.pairing) {
        this.json(res, 403, { error: 'Approve in the local runner window.' }); return true;
      }
      for (const [key, expires] of this.grants) if (expires <= Date.now()) this.grants.delete(key);
      const token = randomBytes(32).toString('hex');
      this.grants.set(token, Date.now() + 8 * 60 * 60 * 1000);
      this.json(res, 200, { token }); return true;
    }
    if (path === '/api/near-demo/bridge-disconnect') {
      if (!this.authorized(req) || req.method !== 'POST') { this.json(res, 403, { error: 'Connection unavailable.' }); return true; }
      this.grants.delete(req.headers['x-pumpcoin-demo-token'] as string);
      this.json(res, 200, { disconnected: true }); return true;
    }
    return false;
  }
}
