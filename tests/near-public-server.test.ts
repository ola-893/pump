import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KeyPair } from 'near-api-js';
import { publicApp } from '../near-demo/public-server.js';

async function serve(path = ':memory:') {
  const app = publicApp({ dbPath: path, origins: ['https://pump.example'] });
  const server = createServer((req, res) => { void app.handler(req, res); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { root: `http://127.0.0.1:${(server.address() as { port: number }).port}`, async close() { server.close(); await once(server, 'close'); app.close(); } };
}

test('hosted service serves public status and health while rejecting all local controls', async () => {
  const server = await serve();
  try {
    const health = await (await fetch(server.root + '/health')).json() as any;
    assert.equal(health.ok, true); assert.equal(health.mainnetTrading, false);
    const status = await (await fetch(server.root + '/api/near-demo/public-status', { headers: { Host: 'pump.example' } })).json() as any;
    assert.equal(status.registry.agents.length, 0); assert.equal(status.registry.models.length, 0); assert.equal(status.token, undefined);
    for (const path of ['status', 'models', 'create', 'register-agent', 'strategy-action', 'vault-start', 'start-continuous', 'public-models', 'public-status?admin=true']) {
      const response = await fetch(server.root + '/api/near-demo/' + path, { method: path === 'status' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: path === 'status' ? undefined : '{}' });
      assert.equal(response.status, 403, path);
      assert.equal((await response.json() as any).token, undefined);
    }
    assert.equal((await fetch(server.root + '/api/near-demo/public-vault-plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: 'unknown', runId: '', action: 'deploy', account: 'alice.testnet', amount: '1' }) })).status, 400);
  } finally { await server.close(); }
});

test('hosted service applies an exact origin allowlist and supports preflight', async () => {
  const server = await serve();
  try {
    assert.equal((await fetch(server.root + '/health', { headers: { Origin: 'https://pump.example.evil.test' } })).status, 403);
    const allowed = await fetch(server.root + '/api/near-demo/public-status', { headers: { Origin: 'https://pump.example' } });
    assert.equal(allowed.status, 200); assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://pump.example');
    const preflight = await fetch(server.root + '/api/near-demo/public-history', { method: 'OPTIONS', headers: { Origin: 'https://pump.example' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  } finally { await server.close(); }
});

test('hosted directory challenges survive a service restart on persistent storage', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'pump-public-')), path = join(folder, 'pump.sqlite');
  let server = await serve(path);
  try {
    const challenge = await (await fetch(server.root + '/api/pump-directory/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account: 'alice.testnet', runnerKey: KeyPair.fromRandom('ed25519').getPublicKey().toString(), action: 'grant' }) })).json() as any;
    assert.ok(challenge.id);
    await server.close(); server = await serve(path);
    const response = await fetch(server.root + '/api/pump-directory/authorize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: challenge.id, signed: { accountId: 'alice.testnet', publicKey: 'bad', signature: '' } }) });
    assert.equal(response.status, 400);
    assert.match((await response.json() as any).error, /signature/);
  } finally { await server.close(); rmSync(folder, { recursive: true, force: true }); }
});
