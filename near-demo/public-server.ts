import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nearDemoApi } from './api.js';
import { DemoStore } from './store.js';
import { PaperDemo } from './service.js';

export function publicApp(options: { dbPath: string; origins: string[] }) {
  const origins = new Set(options.origins);
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)))
      throw new Error('Public client origins must be exact HTTPS origins or loopback development origins.');
  }
  const store = new DemoStore(options.dbPath);
  const api = nearDemoApi({ publicOnly: true, paper: new PaperDemo(store) });
  const send = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(body));
  };
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && !origins.has(origin)) { send(res, 403, { error: 'This origin is not allowed.' }); return; }
    if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204); res.end(); return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      store.db.prepare('SELECT 1').get();
      send(res, 200, { ok: true, network: 'testnet', mode: 'public-directory', mainnetTrading: false }); return;
    }
    try { await api.handle(req, res, () => send(res, 404, { error: 'Public route unavailable.' })); }
    catch { if (!res.headersSent) send(res, 500, { error: 'Public service temporarily unavailable.' }); else res.end(); }
  };
  return { handler, close() { api.close(); store.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  const origin = process.env.PUMP_DIRECTORY_ORIGIN;
  if (!origin || new URL(origin).protocol !== 'https:') throw new Error('Set PUMP_DIRECTORY_ORIGIN to the public HTTPS directory URL, ending in /api/pump-directory.');
  if (process.env.PUMP_DIRECTORY_URL) throw new Error('The public service owns its directory; do not set PUMP_DIRECTORY_URL.');
  const app = publicApp({ dbPath: process.env.PUMP_PUBLIC_DB ?? '/data/pump.sqlite', origins: (process.env.PUMP_DIRECTORY_CLIENT_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean) });
  const server = createServer({ requestTimeout: 20000, headersTimeout: 10000 }, (req, res) => { void app.handler(req, res); });
  server.maxRequestsPerSocket = 100;
  server.listen(port, '0.0.0.0', () => console.log(`Pump public API listening on port ${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => { app.close(); }));
}
