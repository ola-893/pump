import {baseEncode} from 'near-api-js';
import {ownedVaultAccount,type AgentVaults,type VaultDeployment} from './agent-vaults.js';
import {canonical} from './ledger.js';
import {testAccount,TEST_USDC,units,vaultEquity,type WalletPlan} from './types.js';

/** Backfill a current strategy's vault without editing its version, policy or journal.
 * The old vault remains the active redemption target until all custody is returned.
 * Deployment is signed and paid by the registered owner, using the current factory.
 */
export class StrategyVaultUpgrade {
 private readonly vaults:AgentVaults;
 constructor(vaults:AgentVaults){this.vaults=vaults;}
 private get agents(){return this.vaults.agents;}
 private get db(){return this.agents.paper.store.db;}
 private call(signerId:string,receiverId:string,methodName:string,args:Record<string,unknown>,deposit='0',gas='20000000000000'):WalletPlan{
  return {network:'testnet',signerId,receiverId,description:methodName==='deploy'?'Deploy live pricing for the existing unchanged strategy':'Complete existing strategy vault update',actions:[{type:'FunctionCall',params:{methodName,args,deposit,gas}}]};
 }
 async step(runId:string,account:string){
  const run=this.agents.strategies.read(runId),agent=this.agents.read(run.agentId);
  this.agents.strategies.verify(this.agents.paper.store.read(run.sessionId));this.agents.strategies.assertActive(run);
  const owner=testAccount(account);if(owner!==agent.manifest.controller)throw new Error('Connect the registered agent owner’s NEAR testnet wallet.');
  const cfg=this.vaults.config(),previous=cfg.vaults.find(v=>v.runId===runId);
  if(previous?.liveNav)return {phase:'active' as const,contractId:previous.contractId,runId};
  const factory=cfg.factory;
  if(!factory?.liveNav||factory.id!=='pl.'+cfg.parentId||factory.reporterId!==cfg.parentId||units(factory.funding,false)>5n*10n**24n)throw new Error('The latest live-pricing vault factory is required.');
  const contractId=ownedVaultAccount(runId,owner,factory.id);
  const [factoryAccount,funding,code,reporter]=await Promise.all([
   this.vaults.rpc('query',{request_type:'view_account',finality:'final',account_id:factory.id}),
   this.vaults.testnet.view(factory.id,'funding'),this.vaults.testnet.view(factory.id,'vault_code_hash'),this.vaults.testnet.view(factory.id,'reporter_id')]);
  if(factoryAccount.code_hash!==factory.codeHash||funding.value!==factory.funding||baseEncode(Buffer.from(code.value,'base64'))!==factory.vaultCodeHash||reporter.value!==factory.reporterId)throw new Error('Live-pricing factory identity changed.');
  const old=previous?await this.vaults.inspect(agent.id,runId,'',true):null;
  if(old?.state.round||old?.state.pending)throw new Error('Resolve the previous vault round or payout before updating its contract.');
  // Close the original to deposits first; redemptions remain available while paused.
  if(old&&!old.state.paused)return {phase:'pause' as const,contractId,runId,previousContractId:old.contractId,plan:this.call(old.controllerId,old.contractId,'set_paused',{paused:true})};
  const target=await this.vaults.rpc('query',{request_type:'view_account',finality:'final',account_id:contractId},true);
  if(!target)return {phase:'deploy' as const,contractId,runId,plan:this.call(owner,factory.id,'deploy',{
   agent_id:agent.id,manifest_hash:agent.commitment,strategy_id:runId,strategy_hash:run.commitment,name:agent.manifest.name,
   initial_equity:vaultEquity(run.config,run.config.initialCash),public:!old&&this.agents.visibility(agent)==='public',open_after_archive:false,previous_vault:null,
  },factory.funding,'220000000000000')};
  const [observed,keys]=await Promise.all([this.vaults.testnet.view(contractId,'get_state',{},undefined,true),this.vaults.rpc('query',{request_type:'view_access_key_list',finality:'final',account_id:contractId})]);
  const s=observed.value;
  if(target.code_hash!==factory.vaultCodeHash||keys.keys?.length!==0||s.version!=='PUMP-STRATEGY-VAULT-v4'||s.environment!=='testnet-live-nav'||s.factory_id!==factory.id||s.archived||s.agent_id!==agent.id||s.manifest_hash!==agent.commitment||s.strategy_id!==runId||s.strategy_hash!==run.commitment||s.controller_id!==owner||s.reporter_id!==factory.reporterId||s.token_id!==TEST_USDC||!s.live_nav)throw new Error('Replacement vault does not match the unchanged strategy and current live-pricing code.');
  if(old&&(units(old.state.assets)>0n||units(old.state.total_supply)>0n))return {phase:'withdraw' as const,contractId,runId,previousContractId:old.contractId,assets:old.state.assets,pumpCoin:old.state.total_supply,withdrawUrl:'/vaults?agent='+agent.id+'&strategy='+runId};
  if(old&&units(old.state.reserve)>0n)return {phase:'reserve' as const,contractId,runId,previousContractId:old.contractId,amount:old.state.reserve};
  if(old&&(units(s.assets)>0n||units(s.total_supply)>0n))throw new Error('Replacement has unexpected investor funds before activation.');
  if(this.agents.visibility(agent)==='public'&&!s.public)return {phase:'open' as const,contractId,runId,plan:this.call(owner,contractId,'publish',{})};
  if(s.public!==(this.agents.visibility(agent)==='public'))throw new Error('Replacement vault visibility differs from the agent.');
  const replacement:VaultDeployment={agentId:agent.id,runId,strategyHash:run.commitment,manifestHash:agent.commitment,contractId,codeHash:factory.vaultCodeHash,factoryId:factory.id,ownerId:owner,reporterId:factory.reporterId,liveNav:true};
  this.db.exec('BEGIN IMMEDIATE');
  try{
   this.agents.strategies.assertActive(run);
   if(previous){
    this.db.prepare('INSERT INTO near_vault_replacements(run_id,body) VALUES(?,?)').run(runId,canonical({previous,replacement,previousState:old!.state,previousBlock:old!.blockHash,replacementBlock:observed.blockHash,at:new Date().toISOString()}));
    this.db.prepare('DELETE FROM near_owned_vaults WHERE run_id=?').run(runId);
   }
   this.db.prepare('INSERT INTO near_owned_vaults(run_id,body) VALUES(?,?)').run(runId,canonical(replacement));
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
  return {phase:'active' as const,contractId,runId};
 }
}
