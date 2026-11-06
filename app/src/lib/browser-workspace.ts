import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { canonical, initialPortfolio, metrics } from '../../../near-demo/paper-state.js';
import { BENCHMARK_POLICY, type AgentManifest, type StrategyRun, type StrategySettings } from '../../../near-demo/public-types.js';
import { testAccount, validateConfig, type Config, type Event, type Session } from '../../../near-demo/types.js';
import type { BrowserModel } from './browser-models.js';

type Registration = Pick<Config, 'name' | 'strategy' | 'initialCash' | 'tradeCap' | 'exposureCap' | 'dailyTurnoverCap' | 'slippageBps' | 'intervalMs'> & {
  controller: string;
  visibility: 'private' | 'public';
  modelId: string;
};

type PaperRecord = { session: Session; events: Event[] };
type StoredRun = StrategyRun & { paper: PaperRecord };
type StoredAgent = {
  id: string;
  ownerName: string;
  manifest: AgentManifest;
  commitment: string;
  paper: PaperRecord;
  runs: StoredRun[];
};

const databaseName = 'pump-browser-workspace';
const digest = (value: unknown) => bytesToHex(sha256(utf8ToBytes(canonical(value))));

async function agentStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: unknown) => void) => void) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const agents = request.result.createObjectStore('agents', { keyPath: 'id' });
      agents.createIndex('ownerName', 'ownerName', { unique: true });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('agents', mode);
      let result: T;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not save the browser workspace.'));
      operation(transaction.objectStore('agents'), value => { result = value; }, error => {
        reject(error);
        transaction.abort();
      });
    });
  } finally {
    db.close();
  }
}

function listAgents() {
  return agentStore<StoredAgent[]>('readonly', (store, finish) => {
    const request = store.getAll();
    request.onsuccess = () => finish(request.result);
  });
}

function openSession(config: Config, agent: NonNullable<Session['agent']>, id: string = crypto.randomUUID()): PaperRecord {
  return {
    session: {
      id, agent, version: 1, createdAt: new Date().toISOString(), config,
      portfolio: initialPortfolio(config.initialCash), revision: 0, sequence: 0, head: null,
      state: 'stopped', turnover: { day: '', used: '0' },
    },
    events: [],
  };
}

function sessionView(session: Session) {
  const valuationStale = BigInt(session.portfolio.position) > 0n &&
    (!session.portfolio.markAt || Date.now() - Date.parse(session.portfolio.markAt) > session.config.maxQuoteAgeMs);
  const portfolio = valuationStale ? { ...session.portfolio, equity: null, drawdownBps: null } : session.portfolio;
  const shown = { ...session, portfolio };
  return { ...shown, valuationStale, error: null, metrics: metrics(shown) };
}

function activity(events: Event[]) {
  const decisions = events.filter(event => event.kind === 'model' &&
    (event.evidence === 'live-local-model' || event.evidence === 'operator-directed-model'));
  const fills = events.filter(event => event.kind === 'fill');
  const latest = decisions.at(-1);
  return {
    buys: fills.filter(event => event.action === 'BUY').length,
    sells: fills.filter(event => event.action === 'SELL').length,
    decisions: decisions.length,
    holds: events.filter(event => event.kind === 'hold').length,
    fills: fills.length,
    blocked: events.filter(event => event.kind === 'blocked').length,
    directed: events.some(event => event.evidence === 'operator-directed-model'),
    directedFills: fills.filter(event => event.evidence === 'operator-directed-model').length,
    manual: events.some(event => event.evidence === 'manual-scenario'),
    firstAt: events[0]?.at ?? null,
    lastAt: events.at(-1)?.at ?? null,
    latest: latest ? { at: latest.at, proposal: latest.model?.proposal } : null,
    volume: fills.reduce((total, event) => total + BigInt((event.action === 'BUY' ? event.quote?.amountIn : event.quote?.amountOut) ?? 0), 0n).toString(),
  };
}

function agentView(agent: StoredAgent) {
  return {
    visibility: 'private' as const, id: agent.id, manifest: agent.manifest, commitment: agent.commitment,
    sessionId: agent.paper.session.id, createdAt: agent.paper.session.createdAt,
    session: sessionView(agent.paper.session), activity: activity(agent.paper.events),
  };
}

function strategyView(run: StoredRun, archived: boolean) {
  const { paper, ...record } = run;
  return { ...record, archived, session: sessionView(paper.session), activity: activity(paper.events) };
}

export async function browserWorkspace() {
  const records = await listAgents();
  return {
    agents: records.map(agentView),
    strategyRuns: records.flatMap(agent => agent.runs.map((run, index) => strategyView(run, index !== 0))),
    // Runtime and vault state are only populated by an actual runtime or vault.
    vaults: [], execution: { activeId: null, queued: [] }, models: [], measurement: null,
    continuous: null, runtime: { modelId: null, phase: 'idle' }, comparisons: [], market: null,
    policy: BENCHMARK_POLICY,
  };
}

export async function createBrowserAgent(input: Registration, model: BrowserModel, progress?: (completedBytes: number) => void) {
  if (input.visibility !== 'private') throw new Error('Public registration needs a verified connection to the shared directory. You can create a private agent here.');
  if (input.modelId !== model.id) throw new Error('Select the model again before registering.');
  const { controller, modelId, visibility: _visibility, ...settings } = input;
  const config = validateConfig({
    ...settings, source: 'live', endpoint: 'http://127.0.0.1/v1', executionDelayMs: 1500, maxQuoteAgeMs: 30000,
  });
  const owner = testAccount(controller);
  const ownerName = JSON.stringify([owner, config.name.toLowerCase()]);
  const duplicateMessage = 'This controller already has an agent with this name. Open it in My agents or choose another name.';
  if ((await listAgents()).some(agent => agent.ownerName === ownerName)) throw new Error(duplicateMessage);
  const weightsHash = await model.measure(progress);
  const manifest: AgentManifest = {
    version: 'PUMPCOIN-NEAR-AGENT-v1', name: config.name, controller: owner, network: 'NEAR testnet',
    model: { id: model.name, filename: model.filename, bytes: model.bytes, sha256: weightsHash, quantization: model.quantization },
    inference: { policy: 'self-hosted-only', runtime: model.runtime ?? 'llama.cpp', context: 4096, attestation: 'none' },
    strategy: {
      description: config.strategy, pair: 'wNEAR / USDC', tradeCap: config.tradeCap, exposureCap: config.exposureCap,
      dailyTurnoverCap: config.dailyTurnoverCap, slippageBps: config.slippageBps, intervalMs: config.intervalMs,
    },
    mode: 'paper trading; optional Circle testnet clearing', evidence: 'locally measured weights; unsigned local declaration',
  };
  const id = crypto.randomUUID();
  const agent: StoredAgent = {
    id, ownerName, manifest, commitment: digest(manifest), runs: [],
    paper: openSession(config, { id, modelId, weightsHash }),
  };
  try {
    await agentStore<void>('readwrite', (store, finish) => {
      store.add(agent).onsuccess = () => finish();
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'ConstraintError') throw new Error(duplicateMessage);
    throw error;
  }
  return agentView(agent);
}

function saveStrategy(agentId: string, expectedVersion: number, settings: StrategySettings) {
  return agentStore<ReturnType<typeof strategyView>>('readwrite', (store, finish, fail) => {
    const read = store.get(agentId);
    read.onsuccess = () => {
      try {
        const agent = read.result as StoredAgent | undefined;
        if (!agent) throw new Error('Agent registration not found in this browser.');
        const latest = agent.runs[0]?.version ?? 0;
        if (latest !== expectedVersion) throw new Error('A newer strategy version was saved. Refresh before saving again.');
        const { label, strategy, ...limits } = settings;
        if (!label.trim() || label.length > 80 || strategy.trim().length < 20) throw new Error('Name the strategy and describe when it should trade or hold.');
        const config = validateConfig({ ...agent.paper.session.config, ...limits, strategy: strategy.trim() });
        const body: Omit<StrategyRun, 'commitment'> = {
          schema: 'PUMP-STRATEGY-RUN-v1', id: crypto.randomUUID(), agentId, version: latest + 1,
          createdAt: new Date().toISOString(), label: label.trim(), registrationCommitment: agent.commitment,
          sessionId: crypto.randomUUID(), config,
        };
        const binding = agent.paper.session.agent!;
        const run: StoredRun = {
          ...body, commitment: digest(body),
          paper: openSession(config, { ...binding, strategyRunId: body.id }, body.sessionId),
        };
        agent.runs.unshift(run);
        store.put(agent).onsuccess = () => finish(strategyView(run, false));
      } catch (error) {
        fail(error);
      }
    };
  });
}

export async function browserWorkspaceAction(path: string, body: unknown) {
  const request = body as { agentId: string; expectedVersion: number; settings: StrategySettings; id: string; runId: string; action: string };
  if (path === '/strategy-save-paper') {
    const run = await saveStrategy(request.agentId, request.expectedVersion, request.settings);
    return { phase: 'active', run };
  }
  if (path === '/history') {
    const agent = (await listAgents()).find(item => item.paper.session.id === request.id);
    if (!agent) throw new Error('Paper session not found in this browser.');
    return { events: agent.paper.events };
  }
  if (['/strategy-history', '/strategy-export', '/strategy-action'].includes(path)) {
    const agent = (await listAgents()).find(item => item.runs.some(run => run.id === request.runId));
    const run = agent?.runs.find(item => item.id === request.runId);
    if (!agent || !run) throw new Error('Strategy version not found in this browser.');
    if (path === '/strategy-history') return { events: run.paper.events };
    if (path === '/strategy-export') {
      const { paper, ...strategy } = run;
      return {
        bundle: {
          version: 'PUMP-STRATEGY-EVIDENCE-v1', strategy,
          registration: { id: agent.id, manifest: agent.manifest, commitment: agent.commitment },
          paper: { version: 'PUMPCOIN-NEAR-PAPER-v1', ...paper },
          boundary: 'Browser-local paper strategy. Decisions and fills require a connected inference runtime.',
        },
      };
    }
    if (request.action === 'stop') return { session: sessionView(run.paper.session) };
    throw new Error(request.action === 'mark'
      ? 'This browser workspace does not have a live quote connection.'
      : 'This browser workspace does not have an inference runtime for this model.');
  }
  throw new Error('This action needs a connection to the shared directory, market service, or NEAR testnet.');
}
