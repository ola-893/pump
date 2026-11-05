import test from 'node:test';import assert from 'node:assert/strict';
import {baseEncode} from 'near-api-js';
import {DemoStore} from '../near-demo/store.js';import {PaperDemo} from '../near-demo/service.js';import {AgentVaults,vaultAccount,ownedVaultAccount,type VaultConfig} from '../near-demo/agent-vaults.js';import {StrategyVaultUpgrade} from '../near-demo/strategy-vault-upgrade.js';import {vaultReadiness} from '../near-demo/vault-readiness.js';import {TEST_USDC,type Config} from '../near-demo/types.js';
const agentId='00000000-0000-4000-8000-000000000001',runId='00000000-0000-4000-8000-000000000002',owner='owner.testnet';
function fixture(missing=false,privateAgent=false){
 const store=new DemoStore(':memory:'),paper=new PaperDemo(store);
 const config:Config={name:'Upgrade fixture',strategy:'Keep this exact saved strategy and portfolio unchanged.',initialCash:'100000000',tradeCap:'10000000',exposureCap:'30000000',dailyTurnoverCap:'60000000',slippageBps:50,intervalMs:60000,executionDelayMs:1500,maxQuoteAgeMs:30000,source:'live',endpoint:'http://127.0.0.1:8093/v1'};
 const session=paper.create(config),run={id:runId,agentId,version:1,registrationCommitment:"a".repeat(64),sessionId:session.id,config,commitment:'b'.repeat(64)},agent={id:agentId,commitment:'a'.repeat(64),manifest:{name:'Upgrade fixture',controller:owner}};
 let archived=false;
 const agents:any={paper,read:()=>agent,visibility:()=>privateAgent?'private':'public',strategies:{read:()=>run,records:()=>[run],active:()=>archived?undefined:run,verify:()=>run,assertActive:()=>{if(archived)throw new Error('Archived strategy');}}};
 const factory={id:'pl.parent.testnet',liveNav:true,reporterId:'parent.testnet',funding:'4362350000000000000000000',codeHash:'factory-code',vaultCodeHash:baseEncode(Buffer.alloc(32,7))};
 const oldId=vaultAccount(runId,'parent.testnet'),target=ownedVaultAccount(runId,owner,factory.id);
 const previous={agentId,runId,strategyHash:run.commitment,manifestHash:agent.commitment,contractId:oldId,codeHash:'old-code'};
 const cfg:VaultConfig={network:'testnet',parentId:'parent.testnet',factory,vaults:missing?[]:[previous]};
 const old:any={version:'PUMP-STRATEGY-VAULT-v2',environment:'testnet-paper-rounds',agent_id:agentId,manifest_hash:agent.commitment,strategy_id:runId,strategy_hash:run.commitment,controller_id:owner,reporter_id:'old-reporter.testnet',token_id:TEST_USDC,assets:'10000000',reserve:'0',total_supply:'10000000',nonce:1,paused:false,round:null,pending:null};
 const current:any={version:'PUMP-STRATEGY-VAULT-v4',environment:'testnet-live-nav',factory_id:factory.id,agent_id:agentId,manifest_hash:agent.commitment,strategy_id:runId,strategy_hash:run.commitment,controller_id:owner,reporter_id:factory.reporterId,token_id:TEST_USDC,assets:'0',reserve:'0',total_supply:'0',nonce:0,paused:false,archived:false,public:false,pending:null,round:null,live_nav:{reference_equity:config.initialCash,equity:config.initialCash,sequence:0,observed_at_ms:Date.now(),tracking:false}};
 let deployed=false,badCode=false,keys:any[]=[];
 const testnet=new (class extends Object{config={controllerId:owner,reporterId:'old-reporter.testnet'};async view(id:string,method:string,args:any={}){
  let value:any;
  if(id===factory.id)value=method==='funding'?factory.funding:method==='reporter_id'?factory.reporterId:Buffer.alloc(32,7).toString('base64');
  else if(method==='get_state')value=structuredClone(id===oldId?old:current);
  else if(method==='ft_balance_of')value=args.account_id===oldId?String(BigInt(old.assets)+BigInt(old.reserve)):String(BigInt(current.assets)+BigInt(current.reserve));
  else throw new Error('Unsupported fixture view');return {value,blockHash:'finalized-fixture',blockHeight:123};
 }})();
 const vaults=new AgentVaults(agents,testnet as any,cfg);
 vaults.rpc=async(_method,params:any)=>{
  if(params.request_type==='view_access_key_list')return {keys};
  if(params.account_id===factory.id)return {code_hash:factory.codeHash};
  if(params.account_id===oldId)return {code_hash:'old-code'};
  return deployed?{code_hash:badCode?'changed':factory.vaultCodeHash}:null;
 };
 return {store,paper,agents,run,cfg,old,current,target,previous,vaults,upgrade:new StrategyVaultUpgrade(vaults),deploy:()=>deployed=true,badCode:()=>badCode=true,badKeys:()=>keys=[{public_key:'unexpected'}],archive:()=>archived=true,close:()=>{paper.close();store.close();}};
}
test('legacy funds remain withdrawable at their original target until owner deployment and complete redemption are confirmed',async()=>{
 const f=fixture();try{
 const before=JSON.stringify(f.run),history=f.store.export(f.run.sessionId);
 const pause=await f.upgrade.step(runId,owner);assert.equal(pause.phase,'pause');assert.equal(pause.plan!.signerId,owner);assert.equal(pause.plan!.receiverId,f.previous.contractId);
 f.old.paused=true;
 const deploy=await f.upgrade.step(runId,owner);assert.equal(deploy.phase,'deploy');assert.equal(deploy.plan!.actions[0].params.args.strategy_id,runId);assert.equal(deploy.plan!.actions[0].params.args.strategy_hash,f.run.commitment);assert.equal(deploy.plan!.actions[0].params.args.public,false);assert.equal(deploy.plan!.actions[0].params.deposit,f.cfg.factory!.funding);
 f.deploy();assert.equal((await f.upgrade.step(runId,owner)).phase,'withdraw');assert.equal(f.vaults.list()[0].contractId,f.previous.contractId);
 assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM near_vault_replacements').get()!.n,0);
 f.old.assets='0';f.old.total_supply='0';f.old.reserve='500000';assert.equal((await f.upgrade.step(runId,owner)).phase,'reserve');
 f.old.reserve='0';assert.equal((await f.upgrade.step(runId,owner)).phase,'open');f.current.public=true;
 assert.equal((await f.upgrade.step(runId,owner)).phase,'active');assert.equal(f.vaults.list()[0].contractId,f.target);assert.equal(f.vaults.list()[0].liveNav,true);
 assert.equal((await f.upgrade.step(runId,owner)).phase,'active');assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM near_vault_replacements').get()!.n,1);
 assert.equal(JSON.stringify(f.run),before);assert.deepEqual(f.store.export(f.run.sessionId),history);assert.equal(f.store.list().length,1);
 }finally{f.close();}
});
test('missing public and private strategy vaults can be backfilled without saving another strategy',async()=>{
 for(const privateAgent of [false,true]){const f=fixture(true,privateAgent);try{
 const plan=await f.upgrade.step(runId,owner);assert.equal(plan.phase,'deploy');assert.equal(plan.plan!.actions[0].params.args.public,!privateAgent);
 f.current.public=!privateAgent;f.deploy();assert.equal((await f.upgrade.step(runId,owner)).phase,'active');assert.equal(f.vaults.list().length,1);assert.equal(f.store.list().length,1);
 }finally{f.close();}}
});
test('wrong owner, archived strategy, old factory, unexpected code, altered strategy binding and access keys never activate replacements',async()=>{
 const f=fixture(true);try{
 await assert.rejects(f.upgrade.step(runId,'attacker.testnet'),/owner/);f.cfg.factory!.liveNav=false;await assert.rejects(f.upgrade.step(runId,owner),/latest/);f.cfg.factory!.liveNav=true;
 f.deploy();f.current.strategy_hash='f'.repeat(64);await assert.rejects(f.upgrade.step(runId,owner),/Replacement/);f.current.strategy_hash=f.run.commitment;
 f.badCode();await assert.rejects(f.upgrade.step(runId,owner),/Replacement/);assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM near_owned_vaults').get()!.n,0);
 f.archive();await assert.rejects(f.upgrade.step(runId,owner),/Archived/);
 }finally{f.close();}
 const keyed=fixture(true);try{keyed.deploy();keyed.badKeys();await assert.rejects(keyed.upgrade.step(runId,owner),/Replacement/);}finally{keyed.close();}
});
test('readiness fails for each missing or legacy current vault and passes only after verified current code is active',async()=>{
 const missing=fixture(true);try{const report=await vaultReadiness(missing.vaults);assert.equal(report.ready,false);assert.equal(report.missingCurrent,1);assert.equal(report.currentVerified,0);}finally{missing.close();}
 const f=fixture();try{
 assert.equal((await vaultReadiness(f.vaults)).legacyCurrent,1);
 f.old.paused=true;f.old.assets='0';f.old.total_supply='0';f.deploy();f.current.public=true;await f.upgrade.step(runId,owner);
 assert.equal((await vaultReadiness(f.vaults)).ready,true);
 f.current.assets='1000000';f.current.total_supply='1000000';assert.equal((await vaultReadiness(f.vaults)).ready,false);
 f.current.reserve='1000000';assert.equal((await vaultReadiness(f.vaults)).ready,true);
 f.store.db.exec('CREATE TABLE near_strategy_deployments (agent_id TEXT PRIMARY KEY, body TEXT NOT NULL)');
 f.store.db.prepare('INSERT INTO near_strategy_deployments VALUES(?,?)').run(agentId,JSON.stringify({run:f.run,owner,public:true,contractId:f.target}));
 const pending=await vaultReadiness(f.vaults);assert.equal(pending.ready,false);assert.equal(pending.publicInvestorDemoReady,false);assert.equal(pending.pendingDeployments.length,1);assert.equal(pending.pendingDeployments[0].runId,runId);
 f.store.db.exec('DELETE FROM near_strategy_deployments');
 f.current.live_nav.tracking=true;f.current.live_nav.observed_at_ms=Date.now()-61000;assert.equal((await vaultReadiness(f.vaults)).ready,false);
 }finally{f.close();}
});
