import { acceptsVaultCapital, applyVaultCapital, digest, makeEvent, verifyHistory } from '../../../near-demo/ledger.js';
import { PaperDemo } from '../../../near-demo/service.js';
import { IntentMarkets } from '../../../near-demo/intent-markets.js';
import { BrowserPaperStore } from './browser-paper-store.js';
import type { InferenceProgress, ReportInferenceProgress } from './browser-inference-progress.js';
import type { WorkspaceAgent, WorkspacePaper, WorkspaceStrategy, WorkspaceTransfer } from '../../../near-demo/workspace-transfer.js';
import { initialPortfolio, metrics } from '../../../near-demo/paper-state.js';
import { BENCHMARK_POLICY, type AgentManifest, type StrategyRun, type StrategySettings } from '../../../near-demo/public-types.js';
import { paperMarket, testAccount, validateConfig, type Config, type Event, type MarketSelection, type Session } from '../../../near-demo/types.js';
import { journalBatchSize, journalSchema, publicJournalEvent } from '../../../near-demo/directory/public-journal.js';
import { readJournal, sendJournalBatch } from './public-journal-client.js';
import { ModelFolderError, type BrowserModel } from './browser-models.js';
import { changeStrategyVault, readSeedVault, seedVaultAccount, validateSeedVault, verifyRecordedSeed, type SeedFactory, type SeedState, type SeedVault } from './seed-vault.js';
import { strategySeedFactory } from './strategy-seed-factory-config.js';
import { seedFactory } from './seed-factory-config.js';

type Registration = Pick<Config, 'name' | 'strategy' | 'initialCash' | 'tradeCap' | 'exposureCap' | 'dailyTurnoverCap' | 'slippageBps' | 'intervalMs'> & {
  controller: string;
  visibility: 'private' | 'public';
  modelId: string;
};

type PaperRecord = WorkspacePaper;
type StoredRun = WorkspaceStrategy;
type StoredAgent = WorkspaceAgent & {
  ownerName: string;
  publicationRequested?: boolean;
  publication?: { confirmed: boolean; cutoffs: Record<string, number> };
};
export type FundingDraft = {
  manifest: AgentManifest;
  config: Config;
  modelId: string;
  ownerName: string;
  visibility: Registration['visibility'];
  vault: SeedVault;
  strategy?: StrategyRun;
  archived?: boolean;
};
const publicSyncErrors = new Map<string, string>();
const intentMarkets = new IntentMarkets();

const databaseName = 'pump-browser-workspace';
const executionLock = 'pump-browser-inference';
const strategyLockPrefix = 'pump-browser-strategy:';
const executions = new Map<string, { controller: AbortController; continuous: boolean }>();
const errors = new Map<string, Error>();
const capitalErrors = new Map<string, string>();
let activeSession: string | null = null;
let runtimePhase = 'idle';
let inferenceProgress: InferenceProgress | undefined;

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

function sessionView(paper: PaperRecord) {
  const {session}=paper;
  const valuationStale = BigInt(session.portfolio.position) > 0n &&
    (!session.portfolio.markAt || Date.now() - Date.parse(session.portfolio.markAt) > session.config.maxQuoteAgeMs);
  const portfolio = valuationStale ? { ...session.portfolio, equity: null, drawdownBps: null } : session.portfolio;
  const lastMark = valuationStale ? new BrowserPaperStore(paper).lastQuotedValuation(session.id) : undefined;
  const lastValuation = lastMark?.after.equity != null && lastMark.after.markAt ? {
    equity: lastMark.after.equity, realized: lastMark.after.realized, at: lastMark.after.markAt,
    sequence: lastMark.sequence, capital: lastMark.after.vaultCapital?.assets,
  } : null;
  const shown = { ...session, portfolio };
  return { ...shown, lastValuation, valuationStale, error: null, metrics: metrics(shown) };
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
    publicationPending: !agent.publication?.confirmed && (!!agent.publicationRequested || !!agent.publication),
    publicSyncError: publicSyncErrors.get(agent.id), id: agent.id, manifest: agent.manifest, commitment: agent.commitment,
    seedVault: agent.seedVault, strategyVaults: agent.strategyVaults,
    sessionId: agent.paper.session.id, createdAt: agent.paper.session.createdAt,
    session: sessionView(agent.paper), activity: activity(agent.paper.events),
  };
}

function strategySession(run: StoredRun) {
  const execution = executions.get(run.id);
  const error = errors.get(run.id);
  return { ...sessionView(run.paper), state: execution && !execution.controller.signal.aborted ? 'running' as const : 'stopped' as const,
    error: error?.message ?? null,
    capitalError: capitalErrors.get(run.id),
    modelFolderError: error instanceof ModelFolderError };
}

function strategyView(run: StoredRun, archived: boolean, otherTabRunId?: string) {
  const { paper, ...record } = run;
  const session = strategySession(run);
  if (run.id === otherTabRunId) session.state = 'running';
  return { ...record, archived, session, activity: activity(paper.events) };
}

export async function browserWorkspace() {
  const [stored, locks, drafts] = await Promise.all([listAgents(), navigator.locks?.query(), allFundingDrafts()]);
  const records = stored.filter(agent=>agent.seedVault||agent.strategyVaults?.length);
  const held = locks?.held ?? [];
  const runtimeBusy = executions.size > 0 || held.some(lock => lock.name === executionLock);
  const otherTabBusy = executions.size === 0 && runtimeBusy;
  const otherTabRunId = otherTabBusy
    ? held.find(lock => lock.mode === 'exclusive' && lock.name?.startsWith(strategyLockPrefix))?.name?.slice(strategyLockPrefix.length)
    : undefined;
  return {
    agents: records.map(agentView),
    strategyRuns: records.flatMap(agent => agent.runs.map((run, index) => strategyView(run, index !== 0, otherTabRunId))),
    strategyFundingDrafts: drafts.filter(draft=>draft.strategy && records.some(agent=>agent.id===draft.vault.agentId)),
    // Runtime and vault state are only populated by an actual runtime or vault.
    vaults: [], execution: { activeId: activeSession, queued: [], runtimeBusy, otherTabBusy, otherTabRunId }, models: [], measurement: null,
    continuous: null, runtime: { modelId: null, phase: runtimePhase, progress: inferenceProgress }, comparisons: [], market: null,
    policy: BENCHMARK_POLICY,
  };
}

async function allFundingDrafts():Promise<FundingDraft[]> {
  const db=await workspaceDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const request=db.transaction('funding').objectStore('funding').getAll();
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
  } finally { db.close(); }
}

export async function browserFundingDrafts() {
  const [drafts,agents]=await Promise.all([allFundingDrafts(),listAgents()]);
  const registered=new Set(agents.map(agent=>agent.id));
  return drafts.filter(draft=>!registered.has(draft.vault.agentId));
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

function duplicateFundingMessage(draft: FundingDraft) {
  return draft.archived
    ? 'A funding draft already uses this name. Restore it under Archived funding drafts or choose another name.'
    : 'A funding draft already uses this name. Resume it under Continue vault funding or choose another name.';
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
  const [registeredId, drafts] = await Promise.all([
    agentStore<IDBValidKey | undefined>('readonly', (store, finish) => {
      const lookup = store.index('ownerName').getKey(ownerName);
      lookup.onsuccess = () => finish(lookup.result);
    }),
    browserFundingDrafts(),
  ]);
  if (registeredId !== undefined) throw new Error(duplicateMessage);
  const existingDraft = drafts.find(draft => draft.ownerName === ownerName);
  if (existingDraft) throw new Error(duplicateFundingMessage(existingDraft));
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
  const agentId=crypto.randomUUID(), manifestHash=digest(manifest);
  const strategy=newStrategy(agentId,manifestHash,1,'Initial strategy',config);
  const strategyId=strategy.id;
  const vault:SeedVault={factoryId:factory.id,contractId:seedVaultAccount(owner,strategyId,factory.id),owner,agentId,manifestHash,strategyId,
    strategyHash:strategy.commitment,amount:config.initialCash,
    ...(factory.reporterId?{strategyName:manifest.name}:{})};
  validateSeedVault(vault,factory);
  const draft:FundingDraft={manifest,config,modelId,ownerName,visibility,vault,strategy};
  const db=await workspaceDatabase();
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction(['agents','funding'],'readwrite');
      let conflictMessage=duplicateMessage;
      tx.oncomplete=()=>resolve();
      tx.onabort=()=>reject(tx.error??new Error(conflictMessage));
      const lookup=tx.objectStore('agents').index('ownerName').getKey(ownerName);
      lookup.onsuccess=()=>{
        if(lookup.result!==undefined){tx.abort();return;}
        const pending=tx.objectStore('funding').getAll();
        pending.onsuccess=()=>{
          const conflict=(pending.result as FundingDraft[]).find(item=>item.ownerName===ownerName);
          if(conflict){conflictMessage=duplicateFundingMessage(conflict);tx.abort();return;}
          tx.objectStore('funding').add(draft,agentId);
        };
      };
    });
  } finally { db.close(); }
  return draft;
}

export async function finishBrowserAgent(draft:FundingDraft, factory:SeedFactory) {
  const { vault,config,manifest,modelId,ownerName,strategy }=draft, id=vault.agentId;
  const state=await readSeedVault(vault,factory);
  const funding=state&&await ownerDepositConfirmed(vault,factory,state);
  if (!funding || state?.pending || state?.archived ||
      config.initialCash!==vault.amount || manifest.controller!==vault.owner || digest(manifest)!==vault.manifestHash ||
      (strategy ? !matchesStrategyVault(strategy,vault) || digest(strategy.config)!==digest(config)
        : digest({strategyId:vault.strategyId,manifestHash:vault.manifestHash,config})!==vault.strategyHash))
    throw new Error('The wallet deposit has not been confirmed for this agent.');
  const agent: StoredAgent = {
    id, ownerName, manifest, commitment:vault.manifestHash,
    runs:strategy?[attachPaper(strategy,modelId,manifest.model.sha256)]:[],
    ...(strategy?{strategyVaults:[{...vault,...(typeof funding==='string'?{seedReceipt:funding}:{})}]}:{seedVault:vault}),
    publicationRequested:draft.visibility==='public',
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

function newStrategy(agentId:string,registrationCommitment:string,version:number,label:string,config:Config):StrategyRun {
  const body:Omit<StrategyRun,'commitment'>={
    schema:'PUMP-STRATEGY-RUN-v1',id:crypto.randomUUID(),agentId,version,createdAt:new Date().toISOString(),
    label,registrationCommitment,sessionId:crypto.randomUUID(),config,
  };
  return {...body,commitment:digest(body)};
}

function matchesStrategyVault(strategy:StrategyRun,vault:SeedVault) {
  const {commitment,...body}=strategy;
  return commitment===digest(body)&&commitment===vault.strategyHash&&strategy.agentId===vault.agentId&&
    strategy.id===vault.strategyId&&strategy.registrationCommitment===vault.manifestHash&&strategy.config.initialCash===vault.amount;
}

async function ownerDepositConfirmed(vault:SeedVault,factory:SeedFactory,state:NonNullable<Awaited<ReturnType<typeof readSeedVault>>>) {
  return factory.reporterId ? state.public&&BigInt(state.shares)>0n&&await verifyRecordedSeed(vault)
    : state.received===vault.amount&&state.assets===vault.amount&&state.shares===vault.amount;
}

function attachPaper(strategy:StrategyRun,modelId:string,weightsHash:string):StoredRun {
  const paper=openSession(strategy.config,{id:strategy.agentId,modelId,weightsHash,strategyRunId:strategy.id},strategy.sessionId);
  return {...strategy,paper};
}

export async function prepareBrowserStrategy(agentId:string,expectedVersion:number,settings:StrategySettings) {
  const {label,strategy,...limits}=settings;
  if (!label.trim()||label.length>80||strategy.trim().length<20) throw new Error('Name the strategy and describe when it should trade or hold.');
  const db=await workspaceDatabase();
  try {
    return await new Promise<FundingDraft>((resolve,reject)=>{
      const tx=db.transaction(['agents','funding'],'readwrite'),funding=tx.objectStore('funding');
      let result:FundingDraft,problem:unknown;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(problem??tx.error??new Error('Could not save the funding draft.'));
      const agents=tx.objectStore('agents').get(agentId);
      agents.onsuccess=()=>{
        try {
          const agent=agents.result as StoredAgent|undefined;
          if (!agent || (agent.runs[0]?.version??0)!==expectedVersion) throw new Error('Refresh the current strategy before creating a new version.');
          const isPublic=!!agent.publication?.confirmed||!!agent.publicationRequested;
          const factory=isPublic?strategySeedFactory:seedFactory;
          if (!factory) throw new Error('The strategy vault factory is not configured.');
          const config=validateConfig({...agent.paper.session.config,...limits,strategy:strategy.trim()});
          if (paperMarket(config).quote!==paperMarket().quote) throw new Error('Funded strategies must use USDC as the quote currency.');
          const run=newStrategy(agent.id,agent.commitment,expectedVersion+1,label.trim(),config);
          const owner=agent.manifest.controller;
          const vault:SeedVault={factoryId:factory.id,contractId:seedVaultAccount(owner,run.id,factory.id),owner,agentId,
            manifestHash:agent.commitment,strategyId:run.id,strategyHash:run.commitment,amount:config.initialCash,
            ...(factory.reporterId?{strategyName:agent.manifest.name}:{})};
          validateSeedVault(vault,factory);
          result={manifest:agent.manifest,config,modelId:agent.paper.session.agent!.modelId,ownerName:agent.ownerName,
            visibility:isPublic?'public':'private',strategy:run,vault};
          const lookup=funding.get(agentId);
          lookup.onsuccess=()=>{
            if (lookup.result) { result=lookup.result; return; }
            funding.add(result,agentId);
          };
        } catch (error) { problem=error;tx.abort(); }
      };
    });
  } finally { db.close(); }
}

export async function finishBrowserStrategy(draft:FundingDraft,factory:SeedFactory) {
  const {strategy,vault}=draft;
  if (!strategy||!matchesStrategyVault(strategy,vault)) throw new Error('The strategy draft does not match its vault.');
  const finish=async()=>{
    const agent=await readAgent(vault.agentId);
    if (!agent || agent.commitment!==vault.manifestHash || (agent.runs[0]?.version??0)+1!==strategy.version)
      throw new Error('This draft no longer follows the active strategy.');
    const previous=agent.strategyVaults?.find(item=>item.strategyId===agent.runs[0]?.id);
    const state=await readSeedVault(vault,factory);
    const confirmedFunding=state&&await ownerDepositConfirmed(vault,factory,state);
    if (!confirmedFunding||state?.pending||state?.archived) throw new Error('Wait for this strategy’s owner seed to confirm.');
    const previousFactory=previous?.factoryId===strategySeedFactory.id?strategySeedFactory:seedFactory;
    if (previous&&previousFactory) await changeStrategyVault(previous,previousFactory,'archive');
    const db=await workspaceDatabase();
    try {
      await new Promise<void>((resolve,reject)=>{
        const tx=db.transaction(['agents','funding'],'readwrite'),agents=tx.objectStore('agents'),funding=tx.objectStore('funding');
        tx.oncomplete=()=>resolve();
        tx.onabort=()=>reject(tx.error??new Error('This strategy was changed in another tab.'));
        const read=agents.get(agent.id), saved=funding.get(agent.id);
        const commit=()=>{
          if(read.readyState!=='done'||saved.readyState!=='done')return;
          const current=read.result as StoredAgent|undefined;
          if (!current||saved.result?.strategy?.commitment!==strategy.commitment||(current.runs[0]?.version??0)+1!==strategy.version) {tx.abort();return;}
          const run=attachPaper(strategy,draft.modelId,agent.manifest.model.sha256);
          current.runs.unshift(run);
          current.strategyVaults=[...(current.strategyVaults??[]),{...vault,...(typeof confirmedFunding==='string'?{seedReceipt:confirmedFunding}:{})}];
          agents.put(current);funding.delete(agent.id);
        };
        read.onsuccess=commit;
        saved.onsuccess=commit;
      });
    } finally { db.close(); }
    void syncIfPublic(agent.id);
    return strategy;
  };
  return navigator.locks.request(`pump-strategy-funding:${vault.agentId}`,async()=>{
    const current=(await readAgent(vault.agentId))?.runs[0];
    if (!current) return finish();
    return navigator.locks.request(strategyLockPrefix+current.id,{ifAvailable:true},lock=>{
      if (!lock) throw new Error('Stop the active strategy before switching vaults.');
      return finish();
    });
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
    throw new Error('Fund the vault before saving this strategy version.');
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

function capitalVault(agent: StoredAgent, run: StoredRun) {
  if (run.paper.session.testnet || run.paper.session.exercise || !acceptsVaultCapital(run.config)) return;
  return agent.strategyVaults?.find(vault => vault.strategyId===run.id && vault.factoryId===strategySeedFactory.id &&
    vault.strategyHash===run.commitment && vault.manifestHash===agent.commitment && vault.seedReceipt);
}

async function reconcileCapital(agent: StoredAgent, run: StoredRun, state: SeedState | null, signal: AbortSignal) {
  const {session, events}=run.paper, previous=session.portfolio.vaultCapital;
  // Only mirror principal. Once NAV is reported, changes in assets can include returns.
  if (!state || state.pending || state.archived || state.tracking || state.navSequence!==0 || state.assets!==state.supply ||
      state.contractId!==capitalVault(agent,run)?.contractId || previous && state.nonce<=previous.nonce) return false;
  const {assets,nonce,contractId,blockHash}=state;
  if (assets===(previous?.assets??session.config.initialCash)) return false;
  const at=new Date().toISOString();
  const vaultCapital={assets,nonce,contractId,blockHash};
  const after=applyVaultCapital(session,vaultCapital,at);
  const event=makeEvent(session,{at,kind:'mark',evidence:'paper-adjustment',vaultCapital,after,
    reason:'Paper cash adjusted to match confirmed strategy vault capital.'});
  const paper={session,events:[...events]};
  const store=new BrowserPaperStore(paper,signal);
  const lease=store.acquire(session.id);
  store.save(session,lease,event);
  store.release(session.id,lease);
  await saveCycle(agent.id,run.id,session.revision,paper,signal);
  run.paper=paper;
  void syncIfPublic(agent.id);
  return true;
}

export async function syncBrowserVaultCapital(agentId: string, runId: string, state: SeedState) {
  if (!navigator.locks) return false;
  return navigator.locks.request(strategyLockPrefix+runId,{ifAvailable:true},async lock=>{
    if (!lock) return false;
    const agent=await readAgent(agentId),run=agent?.runs[0];
    if (!agent || run?.id!==runId) return false;
    const changed=await reconcileCapital(agent,run,state,new AbortController().signal);
    capitalErrors.delete(runId);
    return changed;
  });
}

async function runPaperCycle(agent: StoredAgent, run: StoredRun, signal: AbortSignal, action: 'cycle' | 'mark') {
  signal.throwIfAborted();
  const saved = await readAgent(agent.id);
  const current = saved?.runs[0];
  signal.throwIfAborted();
  if (!saved || !current || current.id !== run.id) throw new Error('This strategy is archived. Open the current version.');
  if (current.paper.session.testnet) throw new Error('This session is linked to testnet clearing. Use its original workspace.');
  const vault=capitalVault(saved,current);
  if (vault) {
    try {
      await reconcileCapital(saved,current,await readSeedVault(vault,strategySeedFactory),signal);
      capitalErrors.delete(current.id);
    } catch (error) {
      signal.throwIfAborted();
      capitalErrors.set(current.id,error instanceof Error?error.message:'Could not sync confirmed vault capital.');
    }
  }
  signal.throwIfAborted();
  const revision = current.paper.session.revision;
  const store = new BrowserPaperStore(current.paper, signal);
  const service = new PaperDemo(store);
  const sessionId = current.sessionId;
  activeSession = sessionId;
  const startedAt=Date.now();
  const reportProgress:ReportInferenceProgress=(stage,completedBytes,totalBytes)=>{
    inferenceProgress={stage,completedBytes,totalBytes,startedAt};
  };
  reportProgress('scanning');
  try {
    if (action === 'cycle') {
      runtimePhase = 'loading';
      const { prepareBrowserModel, browserInference } = await import('./browser-inference.js');
      const model = await prepareBrowserModel(agent.manifest, current.paper.session.agent!.modelId, signal, reportProgress);
      signal.throwIfAborted();
      runtimePhase = 'running';
      service.setInferenceProvider(browserInference(model, {id:current.id,commitment:current.commitment}, signal, reportProgress));
    }
    reportProgress('quoting');
    const result = await (action === 'mark' ? service.refresh(sessionId) : service.cycle(sessionId));
    signal.throwIfAborted();
    reportProgress('saving');
    await saveCycle(agent.id, current.id, revision, current.paper, signal);
    void syncIfPublic(agent.id);
    if (result.error) errors.set(current.id, new Error(result.error));
    else errors.delete(current.id);
    return { session: strategySession(current) };
  } finally {
    service.close();
    activeSession = null;
    runtimePhase = 'idle';
    inferenceProgress = undefined;
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
      errors.delete(run.id);
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
          await runPaperCycle(agent, run, controller.signal, 'cycle');
          if (controller.signal.aborted) break;
          await new Promise<void>(done => {
            const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); done(); };
            const timer = setTimeout(finish, run.config.intervalMs);
            controller.signal.addEventListener('abort', finish, { once: true });
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) errors.set(run.id, error instanceof Error ? error : new Error('Browser inference failed.'));
      } finally {
        executions.delete(run.id);
      }
    }).catch(reject);
  });
}

export async function exportBrowserWorkspace(): Promise<WorkspaceTransfer> {
  return { version: 'PUMP-LOCAL-WORKSPACE-v1', agents: (await listAgents()).map(({ ownerName: _key, publication: _publication, publicationRequested: _requested, ...agent }) => agent) };
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
    const strategyVaults=agent.strategyVaults?.map(vault=>{
      validateSeedVault(vault);
      const run=runs.find(item=>item.id===vault.strategyId);
      if (!run || vault.owner!==controller || vault.strategyName!==undefined&&vault.strategyName!==agent.manifest.name) throw new Error('A strategy vault does not match its owner.');
      const {paper:_paper,...record}=run;
      if (!matchesStrategyVault(record,vault)) throw new Error('A strategy vault does not match its version.');
      return vault;
    });
    if (strategyVaults && new Set(strategyVaults.map(vault=>vault.strategyId)).size!==strategyVaults.length)
      throw new Error('A strategy version has more than one vault.');
    if (paper.session.portfolio.vaultCapital || runs.some(run => {
      const capital=run.paper.session.portfolio.vaultCapital;
      return capital && !strategyVaults?.some(vault=>vault.strategyId===run.id&&vault.contractId===capital.contractId&&vault.seedReceipt);
    })) throw new Error('A paper capital adjustment does not match its strategy vault.');
    return { id: agent.id, ownerName, manifest: agent.manifest, commitment: agent.commitment, paper, runs, seedVault, strategyVaults };
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

function journalStrategy(agent:StoredAgent,run:StoredRun) {
  const vault=agent.strategyVaults?.find(item=>item.strategyId===run.id&&item.factoryId===strategySeedFactory.id&&item.seedReceipt);
  return { id:run.id,version:run.version,market:paperMarket(run.config).label,
    openingSequence:agent.publication?.cutoffs[run.id]??0,
    ...(vault?.seedReceipt?{vault:{contractId:vault.contractId,manifestHash:vault.manifestHash,strategyHash:vault.strategyHash,
      seedAmount:vault.amount,seedReceipt:vault.seedReceipt}}:{}) };
}

async function syncJournal(agent: StoredAgent) {
  if (!agent.publication?.confirmed) return;
  const profile = journalIdentity(agent);
  const remote = await readJournal(agent.id);
  for (const run of agent.runs) {
    const strategy=journalStrategy(agent,run);
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
  const latest=pending.runs[0]&&journalStrategy(pending,pending.runs[0]);
  await sendJournalBatch({ schema: journalSchema, agent: journalIdentity(pending), strategy:latest?.vault?latest:null, events: [] });
  await setPublication(agentId, true);
  await syncIfPublic(agentId);
}

export async function syncBrowserPublicJournal(agentId: string) {
  await syncIfPublic(agentId);
  const error = publicSyncErrors.get(agentId);
  if (error) throw new Error(error);
}
