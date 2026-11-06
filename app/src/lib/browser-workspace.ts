import { digest, verifyHistory } from '../../../near-demo/ledger.js';
import { PaperDemo } from '../../../near-demo/service.js';
import { IntentMarkets } from '../../../near-demo/intent-markets.js';
import { BrowserPaperStore } from './browser-paper-store.js';
import type { WorkspaceAgent, WorkspacePaper, WorkspaceStrategy, WorkspaceTransfer } from '../../../near-demo/workspace-transfer.js';
import { initialPortfolio, metrics } from '../../../near-demo/paper-state.js';
import { BENCHMARK_POLICY, type AgentManifest, type StrategyRun, type StrategySettings } from '../../../near-demo/public-types.js';
import { paperMarket, testAccount, validateConfig, type Config, type Event, type MarketSelection, type Session } from '../../../near-demo/types.js';
import { journalBatchSize, journalSchema, publicJournalEvent } from '../../../near-demo/directory/public-journal.js';
import { readJournal, sendJournalBatch } from './public-journal-client.js';
import type { BrowserModel } from './browser-models.js';
import { readSeedVault, seedVaultAccount, validateSeedVault, type SeedFactory, type SeedVault } from './seed-vault.js';

type Registration = Pick<Config, 'name' | 'strategy' | 'initialCash' | 'tradeCap' | 'exposureCap' | 'dailyTurnoverCap' | 'slippageBps' | 'intervalMs'> & {
  controller: string;
  visibility: 'private' | 'public';
  modelId: string;
};

type PaperRecord = WorkspacePaper;
type StoredRun = WorkspaceStrategy;
type StoredAgent = WorkspaceAgent & {
  ownerName: string;
  publication?: { confirmed: boolean; cutoffs: Record<string, number> };
};
export type FundingDraft = {
  manifest: AgentManifest;
  config: Config;
  modelId: string;
  ownerName: string;
  visibility: Registration['visibility'];
  vault: SeedVault;
  archived?: boolean;
};
const publicSyncErrors = new Map<string, string>();
const intentMarkets = new IntentMarkets();

const databaseName = 'pump-browser-workspace';
const executionLock = 'pump-browser-inference';
const strategyLockPrefix = 'pump-browser-strategy:';
const executions = new Map<string, { controller: AbortController; continuous: boolean }>();
const errors = new Map<string, string>();
let activeSession: string | null = null;
let runtimePhase = 'idle';

async function workspaceDatabase() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.onupgradeneeded = event => {
      if (!event.oldVersion) {
        const agents = request.result.createObjectStore('agents', { keyPath: 'id' });
        agents.createIndex('ownerName', 'ownerName', { unique: true });
      }
      request.result.createObjectStore('funding');
    };
    request.onblocked = () => reject(new Error('Close other Pump tabs and reload to update this browser workspace.'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.onversionchange = () => db.close();
  return db;
}

async function agentStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, finish: (value: T) => void, fail: (error: unknown) => void) => void) {
  const db=await workspaceDatabase();
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

function readAgent(id: string) {
  return agentStore<StoredAgent | undefined>('readonly', (store, finish) => {
    const request = store.get(id);
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
    visibility: agent.publication?.confirmed ? 'public' as const : 'private' as const,
    publicSyncError: publicSyncErrors.get(agent.id), id: agent.id, manifest: agent.manifest, commitment: agent.commitment, seedVault: agent.seedVault,
    sessionId: agent.paper.session.id, createdAt: agent.paper.session.createdAt,
    session: sessionView(agent.paper.session), activity: activity(agent.paper.events),
  };
}

function strategySession(run: StoredRun) {
  const execution = executions.get(run.id);
  return { ...sessionView(run.paper.session), state: execution?.continuous && !execution.controller.signal.aborted ? 'running' as const : 'stopped' as const,
    error: errors.get(run.id) ?? null };
}

function strategyView(run: StoredRun, archived: boolean) {
  const { paper, ...record } = run;
  return { ...record, archived, session: strategySession(run), activity: activity(paper.events) };
}

export async function browserWorkspace() {
  const [records, locks] = await Promise.all([listAgents(), navigator.locks?.query()]);
  const held = locks?.held ?? [];
  const runtimeBusy = executions.size > 0 || held.some(lock => lock.name === executionLock);
  const otherTabBusy = executions.size === 0 && runtimeBusy;
  const otherTabRunId = otherTabBusy
    ? held.find(lock => lock.mode === 'exclusive' && lock.name?.startsWith(strategyLockPrefix))?.name?.slice(strategyLockPrefix.length)
    : undefined;
  return {
    agents: records.map(agentView),
    strategyRuns: records.flatMap(agent => agent.runs.map((run, index) => strategyView(run, index !== 0))),
    // Runtime and vault state are only populated by an actual runtime or vault.
    vaults: [], execution: { activeId: activeSession, queued: [], runtimeBusy, otherTabBusy, otherTabRunId }, models: [], measurement: null,
    continuous: null, runtime: { modelId: null, phase: runtimePhase }, comparisons: [], market: null,
    policy: BENCHMARK_POLICY,
  };
}

export async function browserFundingDrafts():Promise<FundingDraft[]> {
  const db=await workspaceDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const request=db.transaction('funding').objectStore('funding').getAll();
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  } finally { db.close(); }
}

export async function archiveFundingDraft(id: string, archived: boolean) {
  const db = await workspaceDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('funding', 'readwrite'), funding = tx.objectStore('funding');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('This draft was completed in another tab. Open My agents.'));
      const read = funding.get(id);
      read.onsuccess = () => {
        if (!read.result) { tx.abort(); return; }
        funding.put({ ...read.result, archived }, id);
      };
    });
  } finally { db.close(); }
}

export async function prepareBrowserAgent(input: Registration, model: BrowserModel, factory:SeedFactory, progress?: (completedBytes: number) => void) {
  if (input.modelId !== model.id) throw new Error('Select the model again before registering.');
  if (!model.openWeights) throw new Error('Choose GGUF weights for browser inference.');
  const { controller, modelId, visibility, ...settings } = input;
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
    mode: 'Circle test USDC seed vault; paper trading only', evidence: 'locally measured weights; unsigned local declaration',
  };
  const agentId=crypto.randomUUID(), strategyId=crypto.randomUUID(), manifestHash=digest(manifest);
  const vault:SeedVault={factoryId:factory.id,contractId:seedVaultAccount(owner,strategyId,factory.id),owner,agentId,manifestHash,strategyId,
    strategyHash:digest({strategyId,manifestHash,config}),amount:config.initialCash};
  validateSeedVault(vault,factory);
  const draft:FundingDraft={manifest,config,modelId,ownerName,visibility,vault};
  const db=await workspaceDatabase();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['agents','funding'],'readwrite');
      tx.oncomplete=()=>resolve();
      tx.onabort=()=>reject(tx.error??new Error(duplicateMessage));
      const lookup=tx.objectStore('agents').index('ownerName').getKey(ownerName);
      lookup.onsuccess=()=>{
        if(lookup.result!==undefined){tx.abort();return;}
        const pending=tx.objectStore('funding').getAll();
        pending.onsuccess=()=>{
          if(pending.result.some((item:FundingDraft)=>item.ownerName===ownerName)){tx.abort();return;}
          tx.objectStore('funding').add(draft,agentId);
        };
      };
    });
  } finally { db.close(); }
  return draft;
}

export async function finishBrowserAgent(draft:FundingDraft, factory:SeedFactory) {
  const { vault,config,manifest,modelId,ownerName }=draft, id=vault.agentId;
  const state=await readSeedVault(vault,factory);
  if (!state || state.received!==vault.amount || state.assets!==vault.amount || state.shares!==vault.amount || state.pending ||
      config.initialCash!==vault.amount || manifest.controller!==vault.owner || digest(manifest)!==vault.manifestHash ||
      digest({strategyId:vault.strategyId,manifestHash:vault.manifestHash,config})!==vault.strategyHash)
    throw new Error('The wallet deposit has not been confirmed for this agent.');
  const agent: StoredAgent = {
    id, ownerName, manifest, commitment:vault.manifestHash, runs:[], seedVault:vault,
    paper: openSession(config, { id, modelId, weightsHash:manifest.model.sha256 }),
  };
  const db=await workspaceDatabase();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['agents','funding'],'readwrite'), funding=tx.objectStore('funding');
      tx.oncomplete=()=>resolve();
      tx.onabort=()=>reject(tx.error??new Error('This draft was completed in another tab. Open My agents.'));
      const lookup=funding.get(id);
      lookup.onsuccess=()=>{
        if(lookup.result?.vault?.agentId!==id){tx.abort();return;}
        tx.objectStore('agents').add(agent);
        funding.delete(id);
      };
    });
  } finally { db.close(); }
  return agentView(agent);
}

async function saveStrategy(agentId: string, expectedVersion: number, settings: StrategySettings) {
  const save = () => writeStrategyVersion(agentId, expectedVersion, settings);
  if (!navigator.locks) return save();
  const current = (await readAgent(agentId))?.runs[0];
  if (!current) return save();
  return navigator.locks.request(strategyLockPrefix + current.id, { mode: 'shared', ifAvailable: true }, lock => {
    if (!lock) throw new Error('Stop the active strategy before saving another version.');
    return save();
  });
}

function writeStrategyVersion(agentId: string, expectedVersion: number, settings: StrategySettings) {
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
        if(agent.seedVault && (config.initialCash!==agent.seedVault.amount || paperMarket(config).quote!==paperMarket(agent.paper.session.config).quote))
          throw new Error('Use the confirmed USDC seed amount for this agent’s paper strategy.');
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
  if (path === '/intent-assets') return intentMarkets.catalog();
  if (path === '/intent-market-check') {
    const { market, amount, slippageBps } = body as { market: MarketSelection; amount: string; slippageBps: number };
    return intentMarkets.check(market, amount, slippageBps);
  }
  const request = body as { agentId: string; expectedVersion: number; settings: StrategySettings; id: string; runId: string; action: string };
  if (path === '/strategy-save-paper') {
    const run = await saveStrategy(request.agentId, request.expectedVersion, request.settings);
    void syncIfPublic(request.agentId);
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
          paper: new BrowserPaperStore(paper).export(paper.session.id),
          boundary: 'Browser-local paper strategy. Decisions and fills require a connected inference runtime.',
        },
      };
    }
    return browserStrategyAction(agent, run, request.action);
  }
  throw new Error('This action needs a connection to the shared directory, market service, or NEAR testnet.');
}

function saveCycle(agentId: string, runId: string, revision: number, paper: PaperRecord, signal: AbortSignal) {
  return agentStore<void>('readwrite', (store, finish, fail) => {
    const read = store.get(agentId);
    read.onsuccess = () => {
      if (signal.aborted) { fail(signal.reason); return; }
      const agent = read.result as StoredAgent | undefined;
      const run = agent?.runs[0];
      if (!agent || !run || run.id !== runId || run.paper.session.revision !== revision) {
        fail(new Error('The strategy changed in another tab. The pending result was discarded.'));
        return;
      }
      run.paper = paper;
      store.put(agent).onsuccess = () => finish();
    };
  });
}

async function runPaperCycle(agent: StoredAgent, run: StoredRun, signal: AbortSignal, action: 'cycle' | 'mark') {
  signal.throwIfAborted();
  const current = (await readAgent(agent.id))?.runs[0];
  signal.throwIfAborted();
  if (!current || current.id !== run.id) throw new Error('This strategy is archived. Open the current version.');
  if (current.paper.session.testnet) throw new Error('This session is linked to testnet clearing. Use its original workspace.');
  const revision = current.paper.session.revision;
  const store = new BrowserPaperStore(current.paper, signal);
  const service = new PaperDemo(store);
  const sessionId = current.sessionId;
  activeSession = sessionId;
  try {
    if (action === 'cycle') {
      runtimePhase = 'loading';
      const { prepareBrowserModel, browserInference } = await import('./browser-inference.js');
      const model = await prepareBrowserModel(agent.manifest, current.paper.session.agent!.modelId, signal);
      signal.throwIfAborted();
      runtimePhase = 'running';
      service.setInferenceProvider(browserInference(model, {id:current.id,commitment:current.commitment}, signal));
    }
    const result = await (action === 'mark' ? service.refresh(sessionId) : service.cycle(sessionId));
    signal.throwIfAborted();
    await saveCycle(agent.id, current.id, revision, current.paper, signal);
    void syncIfPublic(agent.id);
    if (result.error) errors.set(current.id, result.error);
    else errors.delete(current.id);
    return { session: strategySession(current) };
  } finally {
    service.close();
    activeSession = null;
    runtimePhase = 'idle';
  }
}

function withPaperExecution<T>(runId: string, work: () => Promise<T>) {
  return navigator.locks.request(executionLock, { ifAvailable: true }, lock => {
    if (!lock) throw new Error('A browser paper session is already running.');
    // The strategy lock identifies the run to other tabs and disappears if this tab closes.
    return navigator.locks.request(strategyLockPrefix + runId, work);
  });
}

async function browserStrategyAction(agent: StoredAgent, run: StoredRun, action: string) {
  if (action === 'stop') {
    const execution = executions.get(run.id);
    if (!execution) {
      const locks = await navigator.locks?.query();
      if (locks?.held?.some(lock => lock.mode === 'exclusive' && lock.name === strategyLockPrefix + run.id))
        throw new Error('Switch to the tab running this strategy to stop it.');
      return { session: strategySession(run) };
    }
    execution.controller.abort();
    if (activeSession === run.sessionId) runtimePhase = 'stopping';
    return { session: strategySession(run) };
  }
  if (action !== 'start' && action !== 'cycle' && action !== 'mark') throw new Error('Unknown paper action.');
  if (agent.runs[0]?.id !== run.id) throw new Error('This strategy is archived. Open the current version.');
  if (!navigator.locks) throw new Error('This browser cannot coordinate paper sessions across tabs.');
  if (action !== 'start') {
    return withPaperExecution(run.id, async () => {
      const controller = new AbortController();
      executions.set(run.id, { controller, continuous: false });
      try {
        return await runPaperCycle(agent, run, controller.signal, action);
      } catch (error) {
        if (!controller.signal.aborted) throw error;
        return { session: strategySession(run), cancelled: true };
      } finally {
        executions.delete(run.id);
      }
    });
  }
  const existing = executions.get(run.id);
  if (existing?.continuous && !existing.controller.signal.aborted) return { session: strategySession(run) };
  return new Promise<{ session: ReturnType<typeof strategySession> }>((resolve, reject) => {
    void withPaperExecution(run.id, async () => {
      if ((await readAgent(agent.id))?.runs[0]?.id !== run.id)
        throw new Error('This strategy is archived. Open the current version.');
      const controller = new AbortController();
      executions.set(run.id, { controller, continuous: true });
      errors.delete(run.id);
      resolve({ session: strategySession(run) });
      try {
        while (!controller.signal.aborted) {
          const result = await runPaperCycle(agent, run, controller.signal, 'cycle');
          if (result.session.error || controller.signal.aborted) break;
          await new Promise<void>(done => {
            const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); done(); };
            const timer = setTimeout(finish, run.config.intervalMs);
            controller.signal.addEventListener('abort', finish, { once: true });
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) errors.set(run.id, error instanceof Error ? error.message : 'Browser inference failed.');
      } finally {
        executions.delete(run.id);
      }
    }).catch(reject);
  });
}

export async function exportBrowserWorkspace(): Promise<WorkspaceTransfer> {
  return { version: 'PUMP-LOCAL-WORKSPACE-v1', agents: (await listAgents()).map(({ ownerName: _key, publication: _publication, ...agent }) => agent) };
}

export function validateWorkspaceTransfer(value: unknown): StoredAgent[] {
  const backup = value as WorkspaceTransfer;
  if (backup?.version !== 'PUMP-LOCAL-WORKSPACE-v1' || !Array.isArray(backup.agents)) throw new Error('Choose a Pump workspace backup.');
  const ids = new Set<string>(), names = new Set<string>();
  return backup.agents.map(agent => {
    if (typeof agent.id !== 'string' || !/^[a-f0-9-]{36}$/.test(agent.id) || ids.has(agent.id) ||
      agent.manifest?.version !== 'PUMPCOIN-NEAR-AGENT-v1' || digest(agent.manifest) !== agent.commitment ||
      !/^[a-f0-9]{64}$/.test(agent.manifest.model.sha256) || !Array.isArray(agent.runs)) throw new Error('An agent identity in this backup could not be verified.');
    const controller = testAccount(agent.manifest.controller);
    const ownerName = JSON.stringify([controller, agent.manifest.name.toLowerCase()]);
    if (names.has(ownerName)) throw new Error('The backup contains duplicate agent names for one controller.');
    names.add(ownerName);
    ids.add(agent.id);
    const binding = agent.paper.session.agent;
    const checkPaper = (paper: PaperRecord, strategyRunId?: string) => {
      const session = paper.session;
      validateConfig(session.config);
      if (session.version !== 1 || session.agent?.id !== agent.id ||
        session.agent.modelId !== binding?.modelId || session.agent.weightsHash !== agent.manifest.model.sha256 ||
        session.agent.strategyRunId !== strategyRunId || !Array.isArray(paper.events)) throw new Error('A paper session has an invalid agent binding.');
      verifyHistory(session, paper.events);
      return { session: { ...session, state: 'stopped' as const }, events: paper.events };
    };
    const paper = checkPaper(agent.paper);
    const versions = new Set<number>();
    const runIds = new Set<string>();
    const runs = agent.runs.map(({ paper: savedPaper, ...run }) => {
      const { commitment, ...body } = run;
      if (run.schema !== 'PUMP-STRATEGY-RUN-v1' || run.agentId !== agent.id || run.registrationCommitment !== agent.commitment ||
        !Number.isSafeInteger(run.version) || run.version < 1 || versions.has(run.version) || runIds.has(run.id) ||
        digest(body) !== commitment || run.sessionId !== savedPaper.session.id ||
        digest(run.config) !== digest(savedPaper.session.config)) throw new Error('A saved strategy version could not be verified.');
      versions.add(run.version);
      runIds.add(run.id);
      return { ...run, paper: checkPaper(savedPaper, run.id) };
    }).sort((a, b) => b.version - a.version);
    const seedVault=agent.seedVault && validateSeedVault(agent.seedVault);
    if(seedVault&&(seedVault.agentId!==agent.id || seedVault.manifestHash!==agent.commitment ||
      seedVault.owner!==controller || seedVault.amount!==paper.session.config.initialCash ||
      seedVault.strategyHash!==digest({strategyId:seedVault.strategyId,manifestHash:seedVault.manifestHash,config:paper.session.config})))
      throw new Error('A saved seed vault does not match its agent.');
    return { id: agent.id, ownerName, manifest: agent.manifest, commitment: agent.commitment, paper, runs, seedVault };
  });
}

export function importBrowserWorkspace(value: unknown) {
  const agents = validateWorkspaceTransfer(value);
  return agentStore<{ imported: number; skipped: number }>('readwrite', (store, finish, fail) => {
    const read = store.getAll();
    read.onsuccess = () => {
      const existing = read.result as StoredAgent[];
      let imported = 0;
      for (const agent of agents) {
        const match = existing.find(current => current.id === agent.id || current.ownerName === agent.ownerName);
        if (match?.id === agent.id && match.commitment === agent.commitment) continue;
        if (match) { fail(new Error('An agent in this backup conflicts with an agent already saved here. Nothing was imported.')); return; }
        store.add(agent);
        imported++;
      }
      finish({ imported, skipped: agents.length - imported });
    };
  });
}

function setPublication(agentId: string, confirmed: boolean) {
  return agentStore<StoredAgent>('readwrite', (store, finish, fail) => {
    const read = store.get(agentId);
    read.onsuccess = () => {
      const agent = read.result as StoredAgent | undefined;
      if (!agent) { fail(new Error('Agent not found in this browser.')); return; }
      agent.publication ??= { confirmed: false, cutoffs: Object.fromEntries(agent.runs.map(run => [run.id, run.paper.session.sequence])) };
      if (confirmed) agent.publication.confirmed = true;
      store.put(agent).onsuccess = () => finish(agent);
    };
  });
}

function journalIdentity(agent: StoredAgent) {
  return { id: agent.id, name: agent.manifest.name, model: agent.manifest.model.id, controller: agent.manifest.controller };
}

async function syncJournal(agent: StoredAgent) {
  if (!agent.publication?.confirmed) return;
  const profile = journalIdentity(agent);
  const remote = await readJournal(agent.id);
  for (const run of agent.runs) {
    const strategy = { id: run.id, version: run.version, market: paperMarket(run.config).label,
      openingSequence: agent.publication.cutoffs[run.id] ?? 0 };
    const existing = remote.strategies.find(item => item.id === run.id);
    const pending = run.paper.events.filter(event => event.sequence > (existing?.head ?? strategy.openingSequence));
    if (!existing && pending.length === 0) await sendJournalBatch({ schema: journalSchema, agent: profile, strategy, events: [] });
    for (let offset = 0; offset < pending.length; offset += journalBatchSize) {
      await sendJournalBatch({ schema: journalSchema, agent: profile, strategy,
        events: pending.slice(offset, offset + journalBatchSize).map(publicJournalEvent) });
    }
  }
}

async function syncIfPublic(agentId: string) {
  try {
    await navigator.locks.request(`pump-public-journal-sync:${agentId}`, async () => {
      const agent = (await listAgents()).find(item => item.id === agentId);
      if (agent?.publication?.confirmed) await syncJournal(agent);
      publicSyncErrors.delete(agentId);
    });
  } catch (error) {
    publicSyncErrors.set(agentId, error instanceof Error ? error.message : 'Could not sync the public journal.');
  }
}

export async function publishBrowserAgent(agentId: string) {
  const pending = await setPublication(agentId, false);
  await sendJournalBatch({ schema: journalSchema, agent: journalIdentity(pending), strategy: null, events: [] });
  await setPublication(agentId, true);
  await syncIfPublic(agentId);
}

export async function syncBrowserPublicJournal(agentId: string) {
  await syncIfPublic(agentId);
  const error = publicSyncErrors.get(agentId);
  if (error) throw new Error(error);
}
