import { IntentMarkets } from './intent-markets.js';
import { baseEncode } from 'near-api-js';
import { ownedVaultAccount, type AgentVaults, type FactoryConfig, type VaultDeployment } from './agent-vaults.js';
import { canonical, digest } from './ledger.js';
import type { StrategyRun, StrategySettings } from './strategy-runs.js';
import { TEST_USDC, testAccount, units, vaultEquity, type WalletPlan } from './types.js';

type Draft = {
  run: StrategyRun;
  owner: string;
  public: boolean;
  previous: VaultDeployment | null;
  olderLegacyVaults: VaultDeployment[];
  factory: FactoryConfig;
  contractId: string;
};
const MAX_FUNDING = 5n * 10n ** 24n;

export class StrategyDeployment {
  private readonly vaults: AgentVaults;
  readonly markets=new IntentMarkets();

  constructor(vaults: AgentVaults) {
    this.vaults = vaults;
    this.db.exec('CREATE TABLE IF NOT EXISTS near_strategy_deployments (agent_id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  }
  private get agents() { return this.vaults.agents; }
  private get db() { return this.agents.paper.store.db; }
  pending() {
    return (this.db.prepare('SELECT agent_id FROM near_strategy_deployments').all() as {agent_id:string}[])
      .map(row => row.agent_id);
  }
  private draft(agentId: string) {
    const row = this.db.prepare('SELECT body FROM near_strategy_deployments WHERE agent_id=?').get(agentId) as {body:string}|undefined;
    return row ? JSON.parse(row.body) as Draft : undefined;
  }
  private view(accountId: string, method: string) {
    return this.vaults.testnet.view(accountId, method).then(x => x.value);
  }
  private account(accountId: string, allowMissing = false) {
    return this.vaults.rpc('query', {request_type:'view_account', finality:'final', account_id:accountId}, allowMissing);
  }
  private plan(signerId:string, receiverId:string, methodName:string, args:Record<string,unknown>,
    gas:string, deposit:string, description:string): WalletPlan {
    return {network:'testnet', signerId, receiverId, description, actions:[{type:'FunctionCall',
      params:{methodName,args,gas,deposit}}]};
  }
  async savePaper(agentId: string, expectedVersion: number, settings: StrategySettings) {
    const assertPaperOnly = () => {
      if (this.agents.visibility(this.agents.read(agentId)) !== 'private' ||
          this.vaults.config().vaults.some(v => v.agentId === agentId) || this.draft(agentId)) {
        throw new Error('This agent must use the wallet-approved vault workflow.');
      }
    };
    assertPaperOnly();
    const run = this.agents.strategies.prepare(agentId, expectedVersion, settings);
    if (typeof run.config.market === 'object') {
      await this.markets.check(run.config.market, run.config.tradeCap, run.config.slippageBps);
    }
    assertPaperOnly();
    return { phase: 'active' as const, run: this.agents.strategies.activate(run, () => {}) };
  }
  async prepare(agentId: string, expectedVersion: number, settings: StrategySettings, account: string) {
    const a = this.agents.read(agentId);
    const owner = testAccount(account);
    if (owner !== a.manifest.controller) throw new Error('Connect the agent owner’s NEAR testnet wallet.');
    if (this.draft(agentId)) throw new Error('Resume the pending vault setup for this agent.');
    if(Buffer.byteLength(a.manifest.name)>64)throw new Error('The registered agent name exceeds the vault’s UTF-8 limit.');
    const run = this.agents.strategies.prepare(agentId, expectedVersion, settings);
    const config = this.vaults.config(), factory = config.factory;
    if (!factory?.liveNav) throw new Error('The latest live-pricing strategy vault factory is required on NEAR testnet.');
    testAccount(factory.id);
    if (factory.id !== (factory.liveNav?'pl.':'pv.')+config.parentId || units(factory.funding,false) > MAX_FUNDING)
      throw new Error('Invalid testnet factory configuration.');
    const [code, funding, childCode] = await Promise.all([
      this.account(factory.id), this.view(factory.id,'funding'), this.view(factory.id,'vault_code_hash'),
    ]);
    if (code.code_hash !== factory.codeHash || funding !== factory.funding ||
        baseEncode(Buffer.from(childCode,'base64')) !== factory.vaultCodeHash)
      throw new Error('Observed factory code or funding differs from the configured deployment.');
    if(factory.liveNav&&(await this.view(factory.id,'reporter_id'))!==factory.reporterId)
      throw new Error('The live pricing reporter differs from the factory configuration.');
    const previousRun = this.agents.strategies.active(agentId);
    if ((previousRun?.version??0)!==expectedVersion)
      throw new Error('The active strategy changed. Refresh before saving.');
    const previous = config.vaults.find(v => v.runId === previousRun?.id) ?? null;
    if (previous) {
      const {state} = await this.vaults.inspect(agentId,previous.runId);
      if (state.round || state.pending) throw new Error('Settle the current vault round and wait for pending payouts before switching.');
      if (state.live_nav?.tracking) throw new Error('Stop the current strategy, close its paper position, and wait for the final vault price before switching.');
    }
    const olderLegacyVaults: VaultDeployment[] = [];
    for (const vault of config.vaults) {
      if (vault.agentId!==agentId || vault.factoryId || vault.runId===previous?.runId) continue;
      const {state} = await this.vaults.inspect(agentId,vault.runId);
      if (state.paused) continue;
      if (state.round || state.pending) throw new Error('Resolve the older vault round or payout before switching.');
      olderLegacyVaults.push(vault);
    }
    if (this.agents.strategies.active(agentId)?.id !== previousRun?.id)
      throw new Error('The active strategy changed. Refresh before saving.');
    if(typeof run.config.market==='object')await this.markets.check(run.config.market,run.config.tradeCap,run.config.slippageBps);
    if (this.agents.strategies.active(agentId)?.id !== previousRun?.id)
      throw new Error('The active strategy changed. Refresh before saving.');
    const draft: Draft = {run, owner, public:this.agents.visibility(a)==='public', previous, olderLegacyVaults, factory,
      contractId:ownedVaultAccount(run.id,owner,factory.id)};
    this.db.prepare('INSERT INTO near_strategy_deployments (agent_id,body) VALUES (?,?)').run(agentId,canonical(draft));
    return this.step(agentId);
  }

  async step(agentId: string) {
    const draft = this.draft(agentId);
    if (!draft) {
      const active = this.agents.strategies.active(agentId);
      if (!active || !this.vaults.config().vaults.some(v => v.runId===active.id && v.factoryId))
        throw new Error('No pending strategy vault setup.');
      return {phase:'active' as const,run:this.agents.strategies.view(active)};
    }
    const {run, owner, factory, contractId, previous, olderLegacyVaults=[]} = draft;
    const agent = this.agents.read(agentId);
    const {commitment,...body} = run;
    if (digest(body)!==commitment || agent.commitment!==run.registrationCommitment ||
        agent.manifest.controller!==owner || (this.agents.visibility(agent)==='public')!==draft.public ||
        contractId!==ownedVaultAccount(run.id,owner,factory.id))
      throw new Error('The saved deployment draft no longer matches this agent.');
    if ((this.agents.strategies.active(agentId)?.version??0)+1!==run.version)
      throw new Error('The active strategy changed since this deployment was prepared.');
    const account = await this.account(contractId,true);
    if (!account) {
      if ((await this.account(factory.id)).code_hash!==factory.codeHash) throw new Error('Vault factory code changed.');
      return {phase:'deploy' as const, contractId, runId:run.id, plan:this.plan(owner,factory.id,'deploy',{
        agent_id:agentId,manifest_hash:agent.commitment,strategy_id:run.id,strategy_hash:commitment,
        name:agent.manifest.name,...(factory.liveNav?{initial_equity:vaultEquity(run.config,run.config.initialCash)}:{}),public:draft.public&&!previous&&!olderLegacyVaults.length,
        open_after_archive:draft.public&&previous?.factoryId===factory.id&&!olderLegacyVaults.length,
        previous_vault:previous?.factoryId===factory.id?previous.contractId:null,
      },'220000000000000',factory.funding,'Deploy and fund the new strategy vault')};
    }
    const [state, keys] = await Promise.all([this.view(contractId,'get_state'),
      this.vaults.rpc('query',{request_type:'view_access_key_list',finality:'final',account_id:contractId})]);
    if (account.code_hash!==factory.vaultCodeHash || keys.keys?.length!==0 ||
        state.version!==(factory.liveNav?'PUMP-STRATEGY-VAULT-v4':'PUMP-STRATEGY-VAULT-v3') || state.factory_id!==factory.id || state.archived ||
        state.environment!==(factory.liveNav?'testnet-live-nav':'testnet-paper-rounds') || state.token_id!==TEST_USDC ||
        factory.liveNav&&state.live_nav?.reference_equity!==vaultEquity(run.config,run.config.initialCash) ||
        state.agent_id!==agentId || state.manifest_hash!==agent.commitment || state.strategy_id!==run.id ||
        state.strategy_hash!==commitment || state.controller_id!==owner ||
        state.reporter_id!==(factory.reporterId??this.vaults.testnet.config.reporterId))
      throw new Error('The deployed vault could not be verified against the signed strategy.');
    const oldVaults = previous ? [previous,...olderLegacyVaults] : olderLegacyVaults;
    for (const vault of oldVaults) {
      const old = await this.vaults.inspect(agentId,vault.runId);
      if (vault.factoryId ? old.state.archived : old.state.paused) {
        if (vault.runId===previous?.runId && old.state.round)
          throw new Error('Settle the previous vault round before switching.');
        continue;
      }
      if (old.state.round || old.state.pending)
        throw new Error('Settle the previous vault round and wait for pending payouts before switching.');
      const args = vault.factoryId ? {agent_id:agentId} : {paused:true};
      return {phase:'archive' as const, contractId, runId:run.id,
        plan:this.plan(old.controllerId,old.contractId,vault.factoryId?'archive':'set_paused',args,
          '20000000000000','0','Close the previous strategy to new deposits and rounds')};
    }
    if (draft.public && !state.public) return {phase:'open' as const, contractId, runId:run.id,
      plan:this.plan(owner,contractId,'publish',{},'20000000000000','0','Open the new vault to investors')};
    if (state.public!==draft.public) throw new Error('The vault visibility differs from the agent.');

    const current = this.draft(agentId);
    if (!current || current.run.id!==run.id) {
      const active = this.agents.strategies.active(agentId);
      if (active?.id===run.id) return {phase:'active' as const,run:this.agents.strategies.view(active)};
      throw new Error('The pending strategy changed.');
    }
    const record: VaultDeployment = {agentId,runId:run.id,strategyHash:commitment,manifestHash:agent.commitment,
      contractId,codeHash:factory.vaultCodeHash,factoryId:factory.id,ownerId:owner,reporterId:factory.reporterId,liveNav:factory.liveNav};
    return {phase:'active' as const,run:this.agents.strategies.activate(run,()=>{
      this.db.prepare('INSERT INTO near_owned_vaults (run_id,body) VALUES (?,?)').run(run.id,canonical(record));
      this.db.prepare('DELETE FROM near_strategy_deployments WHERE agent_id=?').run(agentId);
    })};
  }

  async publicationPlan(agentId:string, account:string) {
    if (this.draft(agentId)) throw new Error('Finish the pending strategy vault before publishing this agent.');
    const a = this.agents.read(agentId), owner = testAccount(account);
    if (this.agents.visibility(a)!=='private' || owner!==a.manifest.controller)
      throw new Error('Connect the private agent’s owner wallet.');
    const active = this.agents.strategies.active(agentId);
    const v = this.vaults.list().find(v=>v.runId===active?.id && v.factoryId);
    if (!v) return null;
    const {state} = await this.vaults.inspect(agentId,v.runId);
    return state.public ? null : this.plan(owner,v.contractId,'publish',{},'20000000000000','0','Open the strategy vault to investors');
  }
}
