import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { nearDemoApi } from './api.js';
const hosting = JSON.parse(readFileSync(new URL('../deployments/hosting.json', import.meta.url), 'utf8'));
process.env.PUMP_APP_ORIGIN ??= hosting.frontend.url;
process.env.PUMP_DIRECTORY_URL ??= hosting.backend.directoryUrl;
const api = nearDemoApi();
const server = createServer((req, res) => {
  void api.handle(req, res, () => { res.writeHead(404); res.end('Pump local runner'); }).catch(() => {
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Local runner request failed.' }));
  });
});
server.listen(5197, '127.0.0.1', () => console.log(`Pump runner ready. Open ${process.env.PUMP_APP_ORIGIN}/register and choose Connect local runner.`));
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { api.close(); server.close(); });
