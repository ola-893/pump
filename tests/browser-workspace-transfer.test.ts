import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWorkspaceTransfer } from '../app/src/lib/browser-workspace.js';
import { digest, initialPortfolio, makeEvent } from '../near-demo/ledger.js';
import type { AgentManifest } from '../near-demo/public-types.js';
import type { Session } from '../near-demo/types.js';
import type { WorkspaceTransfer } from '../near-demo/workspace-transfer.js';

function fixture(): WorkspaceTransfer {
  const id = '00000000-0000-4000-8000-000000000001';
  const manifest: AgentManifest = {
    version: 'PUMPCOIN-NEAR-AGENT-v1', name: 'Local migration test', controller: 'owner.testnet', network: 'NEAR testnet',
    model: { id: 'Fixture', filename: 'fixture.gguf', bytes: 100, sha256: 'a'.repeat(64), quantization: 'Q4' },
    inference: { policy: 'self-hosted-only', runtime: 'llama.cpp', context: 4096, attestation: 'none' },
    strategy: { description: 'Hold if the signal is unclear.', pair: 'wNEAR / USDC', tradeCap: '1000000',
      exposureCap: '1000000', dailyTurnoverCap: '1000000', slippageBps: 50, intervalMs: 60000 },
    mode: 'paper trading; optional Circle testnet clearing', evidence: 'locally measured weights; unsigned local declaration',
  };
  const session: Session = {
    id: '00000000-0000-4000-8000-000000000002', agent: { id, modelId: 'fixture', weightsHash: manifest.model.sha256 },
    version: 1, createdAt: '2026-01-01T00:00:00.000Z', state: 'running', revision: 0, sequence: 0, head: null,
    config: { name: manifest.name, strategy: manifest.strategy.description, initialCash: '100000000', tradeCap: '1000000',
      exposureCap: '1000000', dailyTurnoverCap: '1000000', slippageBps: 50, executionDelayMs: 1500,
      maxQuoteAgeMs: 30000, source: 'live', endpoint: 'http://127.0.0.1/v1', intervalMs: 60000 },
    portfolio: initialPortfolio('100000000'), turnover: { day: '', used: '0' },
  };
  const event = makeEvent(session, { at: '2026-01-01T00:00:01.000Z', kind: 'blocked', evidence: 'live-local-model',
    reason: 'No fresh quote.', after: session.portfolio });
  return { version: 'PUMP-LOCAL-WORKSPACE-v1', agents: [{ id, manifest, commitment: digest(manifest),
    paper: { session: { ...session, head: event.hash, revision: 1, sequence: 1 }, events: [event] }, runs: [] }] };
}

test('migration preserves the event chain and restores sessions stopped', () => {
  const backup = fixture();
  const [agent] = validateWorkspaceTransfer(backup);
  assert.equal(agent.paper.session.state, 'stopped');
  assert.deepEqual(agent.paper.events, backup.agents[0].paper.events);
  assert.equal(agent.paper.session.head, backup.agents[0].paper.session.head);
});

test('migration rejects altered journal content and mismatched model bindings', () => {
  const altered = fixture();
  altered.agents[0].paper.events[0].reason = 'Altered record';
  assert.throws(() => validateWorkspaceTransfer(altered), /Paper history is inconsistent/);
  const wrongModel = fixture();
  wrongModel.agents[0].paper.session.agent!.weightsHash = 'b'.repeat(64);
  assert.throws(() => validateWorkspaceTransfer(wrongModel), /binding/);
});
