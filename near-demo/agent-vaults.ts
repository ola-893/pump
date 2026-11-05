import {vaultReceiptEffect} from './vault-receipt.js';
import {testnetReads,RpcQueryError} from './rpc.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { NearAgents } from './agents.js';
import { TestnetDemo } from './testnet.js';
import { TEST_USDC, testAccount, units, type WalletPlan } from './types.js';
import { digest } from './ledger.js';
export type VaultDeployment={agentId:string;runId:string;strategyHash:string;manifestHash:string;contractId:string;codeHash:string;factoryId?:string;ownerId?:string;reporterId?:string;liveNav?:boolean};
export type FactoryConfig={id:string;codeHash:string;vaultCodeHash:string;funding:string;reporterId?:string;liveNav?:boolean};
export type VaultConfig={ownedRecords?:boolean;network:'testnet';parentId:string;vaults:VaultDeployment[];factory?:FactoryConfig};
export function ownedVaultAccount(runId:string,ownerId:string,factoryId:string){
 const label=createHash('sha256').update(ownerId+':'+runId).digest('hex').slice(0,24);
 return testAccount('s'+label+'.'+factoryId);
}
export function vaultAccount(runId:string,parentId:string){if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(runId))throw new Error('Invalid strategy ID.');testAccount(parentId);if(!parentId.endsWith('.testnet'))throw new Error('Vault parent must be a named testnet account.');const account='s'+runId.replaceAll('-','')+'.'+parentId;testAccount(account);return account;}
export class AgentVaults {
 readonly agents:NearAgents;readonly testnet:TestnetDemo;private configured?:VaultConfig;private fetcher:typeof fetch;
 constructor(agents:NearAgents,testnet:TestnetDemo,configured?:VaultConfig,fetcher:typeof fetch=fetch){this.agents=agents;this.testnet=testnet;this.configured=configured;this.fetcher=fetcher;
  agents.paper.store.db.exec('CREATE TABLE IF NOT EXISTS near_owned_vaults (run_id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS near_vault_replacements (run_id TEXT PRIMARY KEY, body TEXT NOT NULL)');
 }
 config() {
  const c = this.configured ?? JSON.parse(readFileSync(new URL('../deployments/near-agent-vaults.json', import.meta.url), 'utf8')) as VaultConfig;
  if (c.network !== 'testnet' || !Array.isArray(c.vaults) ||
      new Set(c.vaults.map(v => v.runId)).size !== c.vaults.length ||
      new Set(c.vaults.map(v => v.contractId)).size !== c.vaults.length) {
   throw new Error('Invalid strategy vault configuration.');
  }
  const owned=c.ownedRecords===false?[]:(this.agents.paper.store.db.prepare('SELECT body FROM near_owned_vaults').all() as {body:string}[])
   .map(row=>JSON.parse(row.body) as VaultDeployment);
  const superseded=new Map((this.agents.paper.store.db.prepare('SELECT run_id,body FROM near_vault_replacements').all() as {run_id:string;body:string}[]).map(row=>[row.run_id,JSON.parse(row.body)]));
  const base=c.vaults.filter(v=>{
   const receipt=superseded.get(v.runId);if(!receipt)return true;
   const next=owned.find(n=>n.runId===v.runId);
   if(digest(receipt.previous)!==digest(v)||!next||digest(receipt.replacement)!==digest(next)||receipt.previousState.assets!=='0'||receipt.previousState.total_supply!=='0'||receipt.previousState.reserve!=='0'||!receipt.previousState.paused||receipt.previousState.pending||receipt.previousState.round)throw new Error('Vault replacement does not have a verified empty predecessor.');
   return false;
  });
  const vaults=[...base,...owned];
  if(new Set(vaults.map(v=>v.runId)).size!==vaults.length||new Set(vaults.map(v=>v.contractId)).size!==vaults.length)
   throw new Error('Duplicate strategy vault configuration.');
  return {...c,vaults};
 }
 private boundVault(c: VaultConfig, v: VaultDeployment) {
  const a = this.agents.read(v.agentId);
  const run = this.agents.strategies.read(v.runId);
  if (run.agentId !== a.id || run.registrationCommitment !== a.commitment ||
      run.commitment !== v.strategyHash || v.manifestHash !== a.commitment ||
      v.contractId !== (v.factoryId&&v.ownerId
        ? ownedVaultAccount(run.id,v.ownerId,v.factoryId) : vaultAccount(run.id,c.parentId)) || !v.codeHash) {
   throw new Error('Vault deployment differs from its strategy binding.');

  }
  if(v.factoryId&&v.ownerId!==a.manifest.controller)throw new Error('Vault owner differs from the agent controller.');
  return {...v, archived:this.agents.strategies.active(a.id)?.id!==run.id, name:a.manifest.name, version:run.version, network:'testnet', mode:v.liveNav?'live-nav':'paper-rounds',
   controllerId:v.ownerId??this.testnet.config.controllerId, reporterId:v.reporterId??this.testnet.config.reporterId, tokenId:TEST_USDC};
 }
 list() {
  const c = this.config();
  if (this.configured) return c.vaults.map(v => this.boundVault(c,v));
  // The bundled deployment config can refer to agents registered in a different workspace.
  const localAgents = new Set(this.agents.records().map(agent => agent.id));
  return c.vaults.filter(v => localAgents.has(v.agentId)).map(v => this.boundVault(c,v));
 }
 setVisibility(agentId:string,visibility:'private'|'public',expected:'private'|'public'){
  if(visibility==='private'&&this.list().some(v=>v.agentId===agentId&&v.contractId))throw new Error('An agent with a deployed investor vault must remain public so investors can inspect its strategy and redeem.');
  return this.agents.setVisibility(agentId,visibility,expected);
 }
 private deployment(agentId: string, runId: string) {
  const c = this.config();
  const row = c.vaults.find(v => v.agentId === agentId && v.runId === runId);
  if (!row) throw new Error('This strategy has no deployed investment vault.');
  return this.boundVault(c,row);
 }
 async rpc(method:string,params:unknown,allowMissing=false){try{return await testnetReads(this.fetcher).query(method,params);}catch(e){if(allowMissing&&e instanceof RpcQueryError&&e.data?.cause?.name==='UNKNOWN_ACCOUNT')return null;throw e;}}
 async inspect(agentId:string,runId:string,account='',fresh=false){
  if(account)testAccount(account);const v=this.deployment(agentId,runId);
  const [observed,code,keys]=await Promise.all([this.testnet.view(v.contractId,'get_state',{},undefined,fresh),this.rpc('query',{request_type:'view_account',finality:'final',account_id:v.contractId}),this.rpc('query',{request_type:'view_access_key_list',finality:'final',account_id:v.contractId})]);const s=observed.value;
  if(keys.keys?.length!==0||code.code_hash!==v.codeHash||s.version!==(v.liveNav?'PUMP-STRATEGY-VAULT-v4':v.factoryId?'PUMP-STRATEGY-VAULT-v3':'PUMP-STRATEGY-VAULT-v2')||v.factoryId&&s.factory_id!==v.factoryId||s.environment!==(v.liveNav?'testnet-live-nav':'testnet-paper-rounds')||s.agent_id!==agentId||s.strategy_id!==v.runId||s.strategy_hash!==v.strategyHash||(s.round&&(s.round.run_id!==v.runId||s.round.strategy_hash!==v.strategyHash))||s.manifest_hash!==v.manifestHash||s.token_id!==TEST_USDC||s.controller_id!==v.controllerId||s.reporter_id!==v.reporterId)throw new Error('Observed vault identity or code differs from its pinned deployment.');
  for(const key of ['assets','reserve','total_supply'])units(s[key]);
  let shares:string|null=null,walletBalance:string|null=null;
  if(account){const values=await Promise.all([this.testnet.view(v.contractId,'ft_balance_of',{account_id:account},observed.blockHash),this.testnet.view(TEST_USDC,'ft_balance_of',{account_id:account},observed.blockHash)]);shares=values[0].value;walletBalance=values[1].value;units(shares);units(walletBalance);}
  const custodyBalance=(await this.testnet.view(TEST_USDC,'ft_balance_of',{account_id:v.contractId},observed.blockHash)).value;units(custodyBalance);if(units(custodyBalance)<units(s.assets)+units(s.reserve))throw new Error('Vault token balance is below its recorded assets and surplus.');
  const navFresh=!s.live_nav?.tracking||Date.now()-s.live_nav.observed_at_ms<=60000;
  return {...v,navFresh,pumpCoinPrice:BigInt(s.total_supply)>0n?String(BigInt(s.assets)*1000000n/BigInt(s.total_supply)):'1000000',
   state:s,custodyBalance,shares,walletBalance,redeemable:shares===null?null:BigInt(s.total_supply)>0n?String(BigInt(shares)*BigInt(s.assets)/BigInt(s.total_supply)):'0',observedAt:new Date().toISOString(),blockHash:observed.blockHash,blockHeight:observed.blockHeight};
 }
 private call(who:string,to:string,method:string,args:Record<string,unknown>,deposit='0',description=method):WalletPlan{return {network:'testnet',signerId:who,receiverId:to,actions:[{type:'FunctionCall',params:{methodName:method,args,gas:'150000000000000',deposit}}],description};}
 private stopped(runId:string,flat=true){const r=this.agents.strategies.read(runId),s=this.agents.paper.store.read(r.sessionId);this.agents.strategies.verify(s);if(this.agents.paper.view(s).state==='running'||this.agents.paper.execution.activeId===s.id||this.agents.paper.execution.queued.includes(s.id)||(flat&&s.portfolio.position!=='0'))throw new Error('Stop this strategy and close its paper position before beginning or settling a vault round.');return {r,s};}
 async plan(agentId:string,action:string,account:string,amount:string,runId:string,observation?:Awaited<ReturnType<AgentVaults['inspect']>>){
  if(action==='deposit'&&this.agents.visibility(this.agents.read(agentId))!=='public')throw new Error('Publish the agent and its strategy before accepting investor deposits.');
  testAccount(account);const o=observation??await this.inspect(agentId,runId,account),v=o.contractId,s=o.state,expected_nonce=s.nonce;
  if((action==='deposit'||action==='begin')&&(o.archived||s.archived))
   throw new Error('This strategy is archived. Existing investors can withdraw from its original vault.');
  if((action==='deposit'||action==='withdraw'||action==='redeem')&&o.navFresh===false)
   throw new Error('The live valuation is stale. Wait for a confirmed fresh NAV report.');
  if(action==='deposit'&&s.public===false)throw new Error('Publish this strategy vault before accepting investments.');
  if(action==='prepare'){
   const plans:WalletPlan[]=[];for(const target of [account,v])if(!(await this.testnet.view(TEST_USDC,'storage_balance_of',{account_id:target})).value){const b=(await this.testnet.view(TEST_USDC,'storage_balance_bounds')).value;plans.push(this.call(account,TEST_USDC,'storage_deposit',{account_id:target,registration_only:true},b.min,'Register Circle test USDC storage'));}
   if(!(await this.testnet.view(v,'storage_balance_of',{account_id:account})).value){const b=(await this.testnet.view(v,'storage_balance_bounds')).value;plans.push(this.call(account,v,'storage_deposit',{account_id:account,registration_only:true},b.min,'Prepare your pump coin account'));}return plans;
  }
  if(action==='deposit'||action==='reserve'){
   const n=units(amount,false);if(n>1000000000000n)throw new Error('Maximum one million test USDC per operation.');if(n>units(o.walletBalance!))throw new Error('Insufficient Circle test USDC. Request faucet tokens first.');if(s.pending)throw new Error('A payout is pending.');
   if(action==='reserve'&&account!==o.controllerId)throw new Error('Controller only.');if(action==='deposit'&&(s.round||s.paused))throw new Error('Deposits are closed during a paper round or pause.');if(action==='deposit'&&!o.liveNav)throw new Error('This vault needs its live-pricing update before accepting new investments. Existing pump coin can still be withdrawn.');
   if(!(await this.testnet.view(TEST_USDC,'storage_balance_of',{account_id:v})).value||(action==='deposit'&&!(await this.testnet.view(v,'storage_balance_of',{account_id:account})).value))throw new Error('Prepare token storage before funding this vault.');
   const minted=action==='deposit'?(await this.testnet.view(v,'preview_deposit',{amount},o.blockHash)).value:undefined;if(action==='deposit'&&units(minted)===0n)throw new Error('Deposit would mint zero pump coin.');
   return [this.call(account,TEST_USDC,'ft_transfer_call',{receiver_id:v,amount,msg:JSON.stringify(action==='reserve'?{kind:'reserve'}:{kind:'deposit',min_shares:minted,expected_nonce})},'1',action==='reserve'?'Fund this strategy’s separate testnet surplus':'Deposit test USDC and mint pump coin')];
  }
  if(action==='withdraw'){
   const desired=units(amount,false);if(desired>units(o.redeemable)||units(s.assets)===0n)throw new Error('Amount exceeds your available test USDC.');
   if(s.round||s.pending)throw new Error('Withdrawals are unavailable until the current round or payout settles.');
   const shares=desired===units(o.redeemable)?o.shares!:String((desired*units(s.total_supply)+units(s.assets)-1n)/units(s.assets));
   if(units(shares)>units(o.shares!))throw new Error('Amount exceeds your pump coin balance.');
   return [this.call(account,v,'redeem',{shares,min_assets:amount,expected_nonce},'1','Withdraw test USDC and redeem the required pump coin')];
  }
  if(action==='redeem'){const n=units(amount,false);if(n>units(o.shares!))throw new Error('Insufficient pump coin.');if(s.round||s.pending)throw new Error('Wait for the current round or payout to settle.');const min_assets=(await this.testnet.view(v,'preview_redeem',{shares:amount},o.blockHash)).value;return [this.call(account,v,'redeem',{shares:amount,min_assets,expected_nonce},'1','Burn these pump coin for this vault’s test USDC')];}
  if(action==='withdraw-reserve'){if(account!==o.controllerId)throw new Error('Controller only.');units(amount,false);if(s.round||s.pending||units(amount)>units(s.reserve))throw new Error('Surplus unavailable.');return [this.call(account,v,'withdraw_reserve',{amount,expected_nonce},'1','Withdraw only this strategy’s free demo surplus')];}
  if(action==='cancel-expired'){if(!s.round||Date.now()<s.round.started_at_ms+86400000)throw new Error('Emergency cancellation is available 24 hours after round start.');return [this.call(account,v,'cancel_expired_round',{expected_nonce},'0','Cancel an expired unsettled demo round without applying a simulated return')];}
  if(account!==o.reporterId)throw new Error('Reporter only.');
  if(action==='begin'){
   const {r,s:paper}=this.stopped(runId);if(r.agentId!==agentId)throw new Error('Strategy belongs to a different agent.');if(s.round||s.pending||s.paused||units(s.assets)===0n)throw new Error('Deposit first and wait for pending operations.');if(units(paper.portfolio.cash)===0n)throw new Error('Paper reference equity must be positive.');
   return [this.call(account,v,'begin_round',{run_id:r.id,strategy_hash:r.commitment,reference_equity:paper.portfolio.cash,start_sequence:paper.sequence,expected_nonce},'0','Lock investor flows and bind the next paper round')];
  }
  if(action==='settle'){
   if(!s.round)throw new Error('No active paper round.');const {r,s:paper}=this.stopped(s.round.run_id);if(r.agentId!==agentId||r.commitment!==s.round.strategy_hash)throw new Error('Round strategy binding changed.');const bundle=this.agents.strategies.export(r.id);
   if(paper.sequence<s.round.start_sequence||bundle.paper.events.some(e=>e.sequence>s.round.start_sequence&&Date.parse(e.at)<s.round.started_at_ms))throw new Error('Paper activity predates the on-chain round; settlement requires review.');
   const newAssets=units(s.assets)*units(paper.portfolio.cash)/units(s.round.reference_equity);if(newAssets>units(s.assets)+units(s.reserve))throw new Error('Fund this strategy’s surplus before settling its simulated gain.');
   return [this.call(account,v,'settle_round',{run_id:r.id,ending_equity:paper.portfolio.cash,sequence:paper.sequence,evidence_hash:digest(bundle),expected_nonce},'0','Apply a trusted closed paper return; use only this strategy’s surplus')];
  }
  throw new Error('Unsupported agent vault action.');
 }
 async startRound(agentId:string,runId:string){
  const o=await this.inspect(agentId,runId),round=o.state.round;if(o.archived||o.state.archived)throw new Error('Archived strategy.');if(!round)throw new Error('Confirm begin-round on testnet first.');const {r,s}=this.stopped(round.run_id,false);
  if(r.agentId!==agentId||r.commitment!==round.strategy_hash||s.sequence<round.start_sequence)throw new Error('Paper strategy differs from round authorization.');
  const bundle=this.agents.strategies.export(r.id),anchor=round.start_sequence===0?{cash:s.config.initialCash,position:'0'}:bundle.paper.events.find(e=>e.sequence===round.start_sequence)?.after;
  if(!anchor||anchor.position!=='0'||anchor.cash!==round.reference_equity||bundle.paper.events.some(e=>e.sequence>round.start_sequence&&Date.parse(e.at)<round.started_at_ms))throw new Error('Paper state changed outside the authorized round.');
  return this.agents.strategies.action(r.id,'start');
 }
 async stopRound(agentId:string,runId:string){const o=await this.inspect(agentId,runId);if(!o.state.round)throw new Error('No active round.');const r=this.agents.strategies.read(o.state.round.run_id);if(r.agentId!==agentId)throw new Error('Round belongs to another agent.');return this.agents.strategies.action(r.id,'stop');}
 async receipt(agentId:string,runId:string,account:string,hash:string){
  testAccount(account);const v=this.deployment(agentId,runId);if(!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash))throw new Error('Invalid transaction hash.');
  const r=await this.rpc('tx',{tx_hash:hash,sender_account_id:account,wait_until:'FINAL'});
  if(r.transaction?.hash!==hash)throw new Error('Transaction hash differs from the requested receipt.');
  const effect=vaultReceiptEffect(r,account,v.contractId),outcomes=[r.transaction_outcome,...(r.receipts_outcome??[])];
  return {hash,status:r.final_execution_status!=='FINAL'?'pending':r.status?.Failure||outcomes.some((x:any)=>x?.outcome?.status?.Failure)?'failed':'final',effect,observation:await this.inspect(agentId,runId,account)};
 }
}
