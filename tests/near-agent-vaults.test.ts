import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DemoStore} from '../near-demo/store.js';
import {PaperDemo} from '../near-demo/service.js';
import {NearAgents,type AgentRecord} from '../near-demo/agents.js';
import {AgentVaults,vaultAccount,ownedVaultAccount,type VaultConfig} from '../near-demo/agent-vaults.js';
import {TestnetDemo} from '../near-demo/testnet.js';
import {RpcQueryError} from '../near-demo/rpc.js';
import {TEST_USDC,type Config} from '../near-demo/types.js';
import {canonical,digest} from '../near-demo/ledger.js';
import {validateVaultPlan} from '../app/src/lib/agent-vault-wallet.js';
const settings={label:'Vault fixture strategy',strategy:'Use supplied data and HOLD unless the defined signal is present.',initialCash:'100000000',tradeCap:'10000000',exposureCap:'30000000',dailyTurnoverCap:'60000000',slippageBps:50,intervalMs:60000};
function fixture(live=false){
 const store=new DemoStore(':memory:'),paper=new PaperDemo(store,{quotes:()=>({get:async()=>{throw new Error('Named vault fixture: inference is disabled.');}})}),agents=new NearAgents(paper),id=randomUUID();
 const config:Config={name:'katana',strategy:settings.strategy,initialCash:settings.initialCash,tradeCap:settings.tradeCap,exposureCap:settings.exposureCap,dailyTurnoverCap:settings.dailyTurnoverCap,slippageBps:50,intervalMs:60000,executionDelayMs:1500,maxQuoteAgeMs:30000,source:'live',endpoint:'http://127.0.0.1:8093/v1'};
 const session=paper.create(config),manifest:AgentRecord['manifest']={version:'PUMPCOIN-NEAR-AGENT-v1',name:'katana',controller:'owner.testnet',network:'NEAR testnet',model:{id:'named-fixture',filename:'fixture.gguf',bytes:1234,sha256:'a'.repeat(64),quantization:'fixture'},inference:{policy:'self-hosted-only',runtime:'llama.cpp',context:4096,attestation:'none'},strategy:{description:config.strategy,pair:'wNEAR / USDC',tradeCap:config.tradeCap,exposureCap:config.exposureCap,dailyTurnoverCap:config.dailyTurnoverCap,slippageBps:50,intervalMs:60000},mode:'paper trading; optional Circle testnet clearing',evidence:'locally measured weights; unsigned local declaration'};
 const a:AgentRecord={id,createdAt:new Date().toISOString(),manifest,commitment:digest(manifest),sessionId:session.id,local:{modelId:'named-fixture',path:'/fixture.gguf',stamp:'fixture'}};store.db.prepare('INSERT INTO near_agents(id,body) VALUES(?,?)').run(id,canonical(a));
 const run=agents.strategies.save(id,0,settings),contract=live?ownedVaultAccount(run.id,'owner.testnet','pl.parent.testnet'):vaultAccount(run.id,'parent.testnet'),cfg:VaultConfig={network:'testnet',parentId:'parent.testnet',vaults:[{agentId:id,runId:run.id,strategyHash:run.commitment,manifestHash:a.commitment,contractId:contract,codeHash:'fixture-code',...(live?{liveNav:true,factoryId:'pl.parent.testnet',ownerId:'owner.testnet',reporterId:'reporter.testnet'}:{})}]};
 const state:any={version:'PUMP-STRATEGY-VAULT-v2',strategy_id:run.id,strategy_hash:run.commitment,environment:'testnet-paper-rounds',agent_id:id,manifest_hash:a.commitment,token_id:TEST_USDC,controller_id:'owner.testnet',reporter_id:'reporter.testnet',assets:'11000000',reserve:'30000000',total_supply:'10000000',nonce:3,round:null,pending:null,paused:false};
 if(live){state.version='PUMP-STRATEGY-VAULT-v4';state.environment='testnet-live-nav';state.factory_id='pl.parent.testnet';state.live_nav={reference_equity:'100000000',equity:'110000000',sequence:1,observed_at_ms:Date.now(),tracking:false};}
 const testnet=new TestnetDemo({network:'testnet',controllerId:'owner.testnet',reporterId:'reporter.testnet',contractId:null,tokenId:TEST_USDC});
 testnet.view=async(target,method,args={})=>{let value:any;if(method==='get_state')value=structuredClone(state);else if(method==='ft_balance_of')value=target===contract?'10000000':'100000000';else if(method==='preview_deposit')value=String(BigInt(String(args.amount))*BigInt(state.total_supply)/BigInt(state.assets));else if(method==='preview_redeem')value=String(BigInt(String(args.shares))*BigInt(state.assets)/BigInt(state.total_supply));else if(method==='storage_balance_of')value={total:'1250000000000000000000',available:'0'};else if(method==='storage_balance_bounds')value={min:'1250000000000000000000'};else throw new Error('Unexpected fixture method '+method);return {value,blockHash:'fixture-block',blockHeight:123};};
 let wrongCode=false,keys:any[]=[];const fetcher=(async(_url:unknown,options?:RequestInit)=>{const q=JSON.parse(String(options?.body));return new Response(JSON.stringify({result:q.method==='tx'?{transaction:{signer_id:'alice.testnet',receiver_id:contract},final_execution_status:'FINAL',transaction_outcome:{outcome:{status:{SuccessValue:''}}},receipts_outcome:[]}:q.params.request_type==='view_access_key_list'?{keys}:{code_hash:wrongCode?'changed':'fixture-code'}}));}) as typeof fetch;
 const vaults=new AgentVaults(agents,testnet,cfg,fetcher),target={...vaults.list()[0],contractId:contract};
 return {store,paper,agents,a,run,state,vaults,target,cfg,setWrongCode:()=>wrongCode=true,setKeys:()=>keys=[{public_key:'fixture'}],close:async()=>{paper.close();await agents.close();store.close();}};
}
test('agent vault observes pinned code, model declaration and separate share ownership',async()=>{const f=fixture();try{const o=await f.vaults.inspect(f.a.id,f.run.id,'alice.testnet');assert.equal(o.redeemable,'11000000');assert.equal(o.state.reserve,'30000000');assert.equal(o.shares,'10000000');assert.notEqual(vaultAccount(randomUUID(),'parent.testnet'),f.target.contractId);f.setWrongCode();await assert.rejects(f.vaults.inspect(f.a.id,f.run.id),/identity or code/);}finally{await f.close();}});
test('an unknown vault receipt returns a lookup error without waiting for finality',async()=>{
 const f=fixture();
 const account='alice.testnet',hash='1'.repeat(32);
 try{
  f.vaults.rpc=async(method,params)=>{
   assert.equal(method,'tx');
   assert.deepEqual(params,{tx_hash:hash,sender_account_id:account,wait_until:'NONE'});
   throw new RpcQueryError({cause:{name:'UNKNOWN_TRANSACTION'}});
  };
  await assert.rejects(f.vaults.receipt(f.a.id,f.run.id,account,hash),/Transaction not found on NEAR testnet for this account/);
 }finally{await f.close();}
});
test('a configured vault for another workspace does not block listing local vaults', async () => {
  const f = fixture();
  try {
    const vaults = new AgentVaults(f.agents, f.vaults.testnet);
    assert.deepEqual(vaults.list(), []);
  } finally {
    await f.close();
  }
});
test('vaults with account access keys or mismatched agent binding are rejected',async()=>{const f=fixture();try{f.setKeys();await assert.rejects(f.vaults.inspect(f.a.id,f.run.id),/identity or code/);f.cfg.vaults[0].manifestHash='0'.repeat(64);assert.throws(()=>f.vaults.list(),/binding|pinned deployment/);}finally{await f.close();}});
test('deposits mint at NAV with min shares and nonce; surplus stays a separate action',async()=>{const f=fixture(true);try{const p=await f.vaults.plan(f.a.id,'deposit','alice.testnet','5500000',f.run.id);assert.equal(p[0].receiverId,TEST_USDC);assert.deepEqual(JSON.parse(String(p[0].actions[0].params.args.msg)),{kind:'deposit',min_shares:'5000000',expected_nonce:3});validateVaultPlan(p[0],'alice.testnet',f.target);await assert.rejects(f.vaults.plan(f.a.id,'reserve','alice.testnet','1000000',f.run.id),/Controller/);const r=await f.vaults.plan(f.a.id,'reserve','owner.testnet','1000000',f.run.id);validateVaultPlan(r[0],'owner.testnet',f.target);assert.deepEqual(JSON.parse(String(r[0].actions[0].params.args.msg)),{kind:'reserve'});const before=f.store.export(f.a.sessionId);await f.vaults.plan(f.a.id,'prepare','alice.testnet','',f.run.id);assert.deepEqual(f.store.export(f.a.sessionId),before);}finally{await f.close();}});
test('redemption plans burn shares for proportional assets and reject excess holdings',async()=>{const f=fixture();try{const [p]=await f.vaults.plan(f.a.id,'redeem','alice.testnet','5000000',f.run.id);assert.deepEqual(p.actions[0].params.args,{shares:'5000000',min_assets:'5500000',expected_nonce:3});validateVaultPlan(p,'alice.testnet',f.target);await assert.rejects(f.vaults.plan(f.a.id,'redeem','alice.testnet','10000001',f.run.id),/Insufficient/);const tampered=structuredClone(p);tampered.receiverId='other.testnet';assert.throws(()=>validateVaultPlan(tampered,'alice.testnet',f.target),/outside/);tampered.receiverId=p.receiverId;tampered.actions[0].params.args.recipient='attacker.testnet';assert.throws(()=>validateVaultPlan(tampered,'alice.testnet',f.target),/Invalid/);}finally{await f.close();}});
test('round plans bind an idle paper version and settlement verifies its exact evidence',async()=>{const f=fixture();try{const [p]=await f.vaults.plan(f.a.id,'begin','reporter.testnet','',f.run.id);validateVaultPlan(p,'reporter.testnet',f.target);assert.equal(p.actions[0].params.args.reference_equity,'100000000');assert.equal(p.actions[0].params.args.strategy_hash,f.run.commitment);f.state.round={run_id:f.run.id,strategy_hash:f.run.commitment,reference_equity:'100000000',start_sequence:0,started_at_ms:Date.now()};await assert.rejects(f.vaults.plan(f.a.id,'deposit','alice.testnet','1000000',f.run.id),/closed/);await assert.rejects(f.vaults.plan(f.a.id,'redeem','alice.testnet','1000000',f.run.id),/Wait/);const [settle]=await f.vaults.plan(f.a.id,'settle','reporter.testnet','',f.run.id);validateVaultPlan(settle,'reporter.testnet',f.target);assert.equal(settle.actions[0].params.args.ending_equity,'100000000');assert.equal(String(settle.actions[0].params.args.evidence_hash).length,64);await assert.rejects(f.vaults.plan(f.a.id,'settle','alice.testnet','',f.run.id),/Reporter/);f.state.round.strategy_hash='0'.repeat(64);await assert.rejects(f.vaults.plan(f.a.id,'settle','reporter.testnet','',f.run.id),/binding|pinned deployment/);}finally{await f.close();}});
test('empty, live or positioned portfolios cannot authorize rounds; expiry cannot be bypassed',async()=>{const f=fixture();try{f.state.assets='0';await assert.rejects(f.vaults.plan(f.a.id,'begin','reporter.testnet','',f.run.id),/Deposit/);f.state.assets='11000000';await f.agents.strategies.action(f.run.id,'start');await assert.rejects(f.vaults.plan(f.a.id,'begin','reporter.testnet','',f.run.id),/Stop/);f.paper.stop(f.run.sessionId);f.state.round={run_id:f.run.id,strategy_hash:f.run.commitment,started_at_ms:Date.now()};await assert.rejects(f.vaults.plan(f.a.id,'cancel-expired','alice.testnet','',f.run.id),/24 hours/);f.state.round.started_at_ms=Date.now()-86400001;const [p]=await f.vaults.plan(f.a.id,'cancel-expired','alice.testnet','',f.run.id);validateVaultPlan(p,'alice.testnet',f.target);}finally{await f.close();}});
test('wallet guard rejects mainnet, excess attachments, arbitrary calls and withdrawal impersonation',async()=>{const f=fixture(true);try{const [p]=await f.vaults.plan(f.a.id,'deposit','alice.testnet','1000000',f.run.id);for(const mutate of [(x:any)=>x.network='mainnet',(x:any)=>x.actions[0].params.deposit='1000000000000000000000000',(x:any)=>x.actions[0].params.methodName='ft_transfer',(x:any)=>x.signerId='attacker.testnet']){const x=structuredClone(p);mutate(x);assert.throws(()=>validateVaultPlan(x,'alice.testnet',f.target));}await assert.rejects(f.vaults.plan(f.a.id,'withdraw-reserve','alice.testnet','1000000',f.run.id),/Controller/);const [r]=await f.vaults.plan(f.a.id,'withdraw-reserve','owner.testnet','1000000',f.run.id);assert.throws(()=>validateVaultPlan(r,'alice.testnet',f.target));}finally{await f.close();}});

test('a confirmed round can resume its same strategy after a stopped checkpoint, but rejects pre-round history',async()=>{const f=fixture();try{f.state.round={run_id:f.run.id,strategy_hash:f.run.commitment,reference_equity:'100000000',start_sequence:0,started_at_ms:Date.now()-1000};let started='';f.paper.start=(id:string)=>{started=id;return f.paper.view(f.store.read(id));};await f.vaults.startRound(f.a.id,f.run.id);assert.equal(started,f.run.sessionId);await f.paper.refresh(f.run.sessionId);started='';await f.vaults.startRound(f.a.id,f.run.id);assert.equal(started,f.run.sessionId);f.state.round.started_at_ms=Date.now()+10000;await assert.rejects(f.vaults.startRound(f.a.id,f.run.id),/outside the authorized round/);await assert.rejects(f.vaults.plan(f.a.id,'settle','reporter.testnet','',f.run.id),/predates/);}finally{await f.close();}});
test('storage preparation emits only the three required registrations and funding refuses missing storage',async()=>{const f=fixture(true);try{const original=f.vaults.testnet.view.bind(f.vaults.testnet);f.vaults.testnet.view=async(contract,method,args={})=>method==='storage_balance_of'?{value:null,blockHash:'fixture-block',blockHeight:123}:original(contract,method,args);const plans=await f.vaults.plan(f.a.id,'prepare','alice.testnet','',f.run.id);assert.equal(plans.length,3);for(const p of plans)validateVaultPlan(p,'alice.testnet',f.target);await assert.rejects(f.vaults.plan(f.a.id,'deposit','alice.testnet','1000000',f.run.id),/Prepare token/);}finally{await f.close();}});

test('investors withdraw a USDC amount with rounded-up shares and an explicit minimum payout',async()=>{const f=fixture();try{const [p]=await f.vaults.plan(f.a.id,'withdraw','alice.testnet','5000000',f.run.id);assert.deepEqual(p.actions[0].params.args,{shares:'4545455',min_assets:'5000000',expected_nonce:3});validateVaultPlan(p,'alice.testnet',f.target);await assert.rejects(f.vaults.plan(f.a.id,'withdraw','alice.testnet','11000001',f.run.id),/exceeds/);}finally{await f.close();}});

test('withdrawing the full available balance redeems all shares instead of leaving rounding dust',async()=>{const f=fixture();try{f.state.assets='4';f.state.total_supply='10';const original=f.vaults.testnet.view.bind(f.vaults.testnet);f.vaults.testnet.view=async(target,method,args={})=>target===f.target.contractId&&method==='ft_balance_of'?{value:'9',blockHash:'fixture-block',blockHeight:123}:original(target,method,args);const [p]=await f.vaults.plan(f.a.id,'withdraw','alice.testnet','3',f.run.id);assert.equal(p.actions[0].params.args.shares,'9');assert.equal(p.actions[0].params.args.min_assets,'3');}finally{await f.close();}});

test('archived strategy vault keeps withdrawals and rejects deposits and new rounds',async()=>{
 const f=fixture();
 try{
  const v2=f.agents.strategies.save(f.a.id,1,{...settings,label:'Second version'});
  await assert.rejects(f.vaults.inspect(f.a.id,v2.id,'alice.testnet'),/no deployed investment vault/);
  const contractId=vaultAccount(v2.id,f.cfg.parentId);
  f.cfg.vaults.push({agentId:f.a.id,runId:v2.id,strategyHash:v2.commitment,manifestHash:f.a.commitment,contractId,codeHash:'fixture-code'});
  assert.notEqual(contractId,f.target.contractId);
  await assert.rejects(f.vaults.plan(f.a.id,'deposit','alice.testnet','1000000',f.run.id),/archived/);
  await assert.rejects(f.vaults.plan(f.a.id,'begin','reporter.testnet','',f.run.id),/archived/);
  const [plan]=await f.vaults.plan(f.a.id,'withdraw','alice.testnet','1000000',f.run.id);
  assert.equal(plan.receiverId,f.target.contractId);
  validateVaultPlan(plan,'alice.testnet',f.target);
  assert.throws(()=>validateVaultPlan(plan,'alice.testnet',{...f.target,contractId,runId:v2.id,strategyHash:v2.commitment}),/outside this strategy vault/);
  assert.deepEqual(f.vaults.list().map(v=>v.contractId),[f.target.contractId,contractId]);
  await assert.rejects(f.vaults.inspect(f.a.id,v2.id),/pinned deployment/);
  await assert.rejects(f.vaults.inspect(randomUUID(),v2.id),/no deployed investment vault/);
 }finally{await f.close();}
});

test('legacy contracts retain redemption but cannot accept new investor deposits',async()=>{
 const f=fixture();try{await assert.rejects(f.vaults.plan(f.a.id,'deposit','alice.testnet','1000000',f.run.id),/live-pricing update/);const [p]=await f.vaults.plan(f.a.id,'withdraw','alice.testnet','1000000',f.run.id);assert.equal(p.receiverId,f.target.contractId);}finally{await f.close();}
});
