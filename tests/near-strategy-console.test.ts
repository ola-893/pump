import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { baseEncode } from 'near-api-js';
import { randomUUID } from 'node:crypto';
import { DemoStore } from '../near-demo/store.js';
import { PaperDemo } from '../near-demo/service.js';
import { NearAgents, type AgentRecord } from '../near-demo/agents.js';
import { canonical, digest } from '../near-demo/ledger.js';
import { infer } from '../near-demo/model.js';
import { liveQuotes } from '../near-demo/quotes.js';
import { nearDemoApi } from '../near-demo/api.js';
import { TestnetDemo } from '../near-demo/testnet.js';
import { TEST_USDC, type Config } from '../near-demo/types.js';
import type { AgentManifest } from '../near-demo/public-types.js';
const raw=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-dry-quote.json',import.meta.url),'utf8'));
const fixtureNow=()=>Date.parse(raw.timestamp);
const fixtureQuotes=()=>({get:async(tokenIn:string,tokenOut:string,amountIn:string)=>liveQuotes((async()=>new Response(JSON.stringify(raw),{status:201})) as typeof fetch,fixtureNow).get(tokenIn,tokenOut,amountIn,raw.quoteRequest.slippageTolerance)});
const config:Config={name:'katana',initialCash:'100000000',tradeCap:'20000000',exposureCap:'80000000',dailyTurnoverCap:'100000000',slippageBps:50,executionDelayMs:1500,maxQuoteAgeMs:30000,source:'live',endpoint:'http://127.0.0.1:8093/v1',strategy:'Original public strategy; preserve capital.',intervalMs:60000};
const settings={label:'Momentum strategy',strategy:'Buy only a confirmed rising hourly trend with volume. Size from volatility; exit if the trend breaks. HOLD without confirmation.',initialCash:'100000000',tradeCap:'15000000',exposureCap:'60000000',dailyTurnoverCap:'90000000',slippageBps:50,intervalMs:60000};
function addAgent(agents:NearAgents,name='katana'){
 const session=agents.paper.create({...config,name});const manifest:AgentManifest={version:'PUMPCOIN-NEAR-AGENT-v1',name,controller:'operator.testnet',network:'NEAR testnet',model:{id:'named-fixture-'+name,filename:name+'.gguf',bytes:1234,sha256:'a'.repeat(64),quantization:'fixture'},inference:{policy:'self-hosted-only',runtime:'llama.cpp',context:4096,attestation:'none'},strategy:{description:config.strategy,pair:'wNEAR / USDC',tradeCap:config.tradeCap,exposureCap:config.exposureCap,dailyTurnoverCap:config.dailyTurnoverCap,slippageBps:50,intervalMs:60000},mode:'paper trading; optional Circle testnet clearing',evidence:'locally measured weights; unsigned local declaration'};
 const a:AgentRecord={id:randomUUID(),createdAt:new Date().toISOString(),manifest,commitment:digest(manifest),sessionId:session.id,local:{modelId:'fixture-'+name,path:'/fixture/'+name+'.gguf',stamp:'test-fixture'}};
 agents.paper.store.db.prepare('INSERT INTO near_agents(id,body) VALUES(?,?)').run(a.id,canonical(a));return a;
}
function fixture(){const store=new DemoStore(':memory:'),paper=new PaperDemo(store,{quotes:fixtureQuotes,now:fixtureNow,delay:async()=>{}}),agents=new NearAgents(paper),a=addAgent(agents);return {store,paper,agents,a};}
function useFixtureInference(f:ReturnType<typeof fixture>){f.paper.setInferenceProvider(async(s,q)=>{
 const run=f.agents.strategies.verify(s);const fetcher=(async(url:unknown,opts?:RequestInit)=>String(url).endsWith('/models')?new Response(JSON.stringify({data:[{id:s.agent!.modelId}]})):new Response(JSON.stringify({model:s.agent!.modelId,choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'HOLD',quoteUnits:'0',reason:'Named fixture HOLD: entry confirmation absent.'})}}]}))) as typeof fetch;
 return infer(s,q,fetcher,{strategyVersion:{id:run.id,commitment:run.commitment}} as any);
 });}
test('console saves stopped independent portfolios with immutable strategies and leaves original evidence untouched',async()=>{
 const f=fixture();try{const before=f.store.export(f.a.sessionId),registration=f.agents.read(f.a.id);const v1=f.agents.strategies.save(f.a.id,0,settings);assert.equal(v1.session.state,'stopped');assert.equal(v1.session.sequence,0);assert.equal(v1.session.portfolio.equity,'100000000');assert.equal(v1.session.exercise,undefined);assert.equal(v1.config.strategy,settings.strategy);assert.notEqual(v1.sessionId,f.a.sessionId);
 const v2=f.agents.strategies.save(f.a.id,1,{...settings,label:'Mean reversion',strategy:'Buy only after an oversold dip stabilizes; exit near the recent average. HOLD when volatility remains elevated.',initialCash:'200000000'});assert.equal(v2.version,2);assert.notEqual(v1.sessionId,v2.sessionId);assert.equal(f.agents.strategies.read(v1.id).config.strategy,settings.strategy);assert.deepEqual(f.store.export(f.a.sessionId),before);assert.deepEqual(f.agents.read(f.a.id),registration);assert.equal(f.store.read(v1.sessionId).portfolio.equity,'100000000');assert.equal(v2.session.portfolio.equity,'200000000');assert.throws(()=>f.agents.strategies.save(f.a.id,1,settings),/newer/);assert.equal(f.agents.strategies.list().length,2);
 }finally{f.paper.close();await f.agents.close();f.store.close();}
});
test('console Run once sends the saved strategy and portfolio to the selected model, records HOLD, and exports consistent evidence',async()=>{
 const f=fixture();try{useFixtureInference(f);const r=f.agents.strategies.save(f.a.id,0,settings);await f.agents.strategies.action(r.id,'cycle');const history=f.agents.strategies.history(r.id);assert.ok(history.some(e=>e.kind==='model'),JSON.stringify(history.map(e=>e.reason)));const m=history.find(e=>e.kind==='model')!,input=JSON.parse((m.model!.request as any).messages[1].content);assert.equal(input.strategy,settings.strategy);assert.equal(input.strategyVersion.id,r.id);assert.equal(input.strategyVersion.commitment,r.commitment);assert.equal(input.portfolio.cash,settings.initialCash);assert.equal(input.perTradeQuoteUnits,settings.tradeCap);assert.equal(input.marketContext.executionExercise,undefined);assert.equal(m.model!.id,'fixture-katana');assert.equal(m.evidence,'live-local-model');assert.equal(f.agents.strategies.view(r).activity.holds,1);assert.equal(f.agents.strategies.view(r).activity.fills,0);assert.equal(f.agents.strategies.export(r.id).paper.replay.events,2);assert.equal(f.store.read(f.a.sessionId).sequence,0);
 const tampered={...f.store.read(r.sessionId),config:{...r.config,strategy:'A different strategy'}};assert.throws(()=>f.agents.strategies.verify(tampered),/does not match/);
 }finally{f.paper.close();await f.agents.close();f.store.close();}
});
test('strategy runs reject forced exercises, manual fills, token funding, malformed settings, and overlap with active versions',async()=>{
 const f=fixture();try{const r=f.agents.strategies.save(f.a.id,0,settings);assert.throws(()=>f.paper.checkExercise(r.sessionId),/do not accept forced/);await assert.rejects(f.paper.cycle(r.sessionId,{action:'BUY',quoteUnits:'1000000',reason:'fixture manual injection'}),/Manual scenarios/);assert.equal(f.store.read(r.sessionId).portfolio.cash,settings.initialCash);assert.equal(f.store.history(r.sessionId).filter(e=>e.kind==='fill').length,0);assert.equal(f.agents.strategies.export(r.id).paper.replay.events,0);await assert.rejects(f.paper.attach(r.sessionId,'owner.testnet',{claim:settings.initialCash,session_id:r.sessionId,pending:null,deposited:settings.initialCash}),/virtual capital/);
 for(const bad of [{...settings,tradeCap:'900000000'},{...settings,intervalMs:1},{...settings,slippageBps:5000},{...settings,strategy:'short'}])assert.throws(()=>f.agents.strategies.save(f.a.id,1,bad));
 await f.agents.strategies.action(r.id,'start');assert.equal(f.paper.view(f.store.read(r.sessionId)).state,'running');assert.throws(()=>f.agents.strategies.save(f.a.id,1,settings),/Stop this agent/);await f.agents.strategies.action(r.id,'stop');assert.equal(f.paper.view(f.store.read(r.sessionId)).state,'stopped');
 }finally{f.paper.close();await f.agents.close();f.store.close();}
});
test('strategy version persistence survives restart; workers do not auto-start',async()=>{
 const f=fixture();try{const r=f.agents.strategies.save(f.a.id,0,settings);useFixtureInference(f);await f.agents.strategies.action(r.id,'cycle');f.paper.close();await f.agents.close();const nextPaper=new PaperDemo(f.store),next=new NearAgents(nextPaper);try{assert.equal(next.strategies.read(r.id).commitment,r.commitment);assert.equal(next.strategies.list()[0].session.state,'stopped');assert.equal(next.strategies.list()[0].activity.decisions,1);assert.equal(next.strategies.export(r.id).paper.replay.events,2);}finally{nextPaper.close();await next.close();}}finally{f.store.close();}
});
test('console endpoints wire save, view, run-once, journal and export while enforcing token/origin/field checks',async()=>{
 const store=new DemoStore(':memory:'),paper=new PaperDemo(store,{quotes:fixtureQuotes,now:fixtureNow,delay:async()=>{}});
 const factory={liveNav:true,reporterId:'owner.testnet',id:'pl.parent.testnet',codeHash:'factory-code',vaultCodeHash:baseEncode(Buffer.alloc(32,7)),funding:'4000000000000000000000000'};
 const deployed=new Map<string,any>();
 const rpc:typeof fetch=async(_url,opts)=>{
   const {params}=JSON.parse(String(opts?.body)), address=params.account_id, state=deployed.get(address);
   const respond=(result:unknown)=>new Response(JSON.stringify({result}));
   if(params.request_type==='view_account'){
     if(address===factory.id)return respond({code_hash:factory.codeHash});
     if(state)return respond({code_hash:factory.vaultCodeHash});
     return new Response(JSON.stringify({error:{cause:{name:'UNKNOWN_ACCOUNT'}}}));
   }
   if(params.request_type==='view_access_key_list')return respond({keys:[]});
   const method=params.method_name;
   const value=address===factory.id?method==='funding'?factory.funding:method==='reporter_id'?factory.reporterId:Buffer.alloc(32,7).toString('base64'):
     method==='get_state'?state:'0';
   return respond({result:[...Buffer.from(JSON.stringify(value))],block_height:1,block_hash:'fixture'});
 };
 const api=nearDemoApi({paper,vaultFetcher:rpc,vaultConfig:{network:'testnet',parentId:'parent.testnet',vaults:[],factory},
   testnet:new TestnetDemo({network:'testnet',controllerId:'owner.testnet',reporterId:'owner.testnet',contractId:null,tokenId:TEST_USDC},rpc)});
 // Reporter behavior is covered in near-live-nav.test.ts; this fixture exercises wallet deployment and route guards.
 api.agents.strategies.beforeAction=undefined;
 const a=addAgent(api.agents), account=a.manifest.controller;
 const simulateDeployment=(prepared:any)=>{
   const {contractId,plan}=prepared,{args}=plan.actions[0].params;
   deployed.set(contractId,{version:'PUMP-STRATEGY-VAULT-v4',factory_id:factory.id,archived:false,public:args.public,
     environment:'testnet-live-nav',live_nav:{reference_equity:settings.initialCash,equity:settings.initialCash,sequence:0,observed_at_ms:Date.now(),tracking:false},token_id:TEST_USDC,agent_id:a.id,manifest_hash:a.commitment,
     strategy_id:args.strategy_id,strategy_hash:args.strategy_hash,controller_id:account,reporter_id:'owner.testnet',
     assets:'0',reserve:'0',total_supply:'0',round:null,pending:null,nonce:0,paused:false});
 };
 useFixtureInference({store,paper,agents:api.agents,a});
 const server=createServer((req,res)=>void api.handle(req,res,()=>{res.writeHead(404);res.end();}));server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}/api/near-demo`;let token='';
 const post=async(path:string,body:unknown,extra:Record<string,string>={})=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':token,...extra},body:JSON.stringify(body)});return {status:r.status,body:await r.json() as any};};
 try{const state=await (await fetch(base+'/status')).json() as any;token=state.token;
 assert.equal((await post('/strategy-save',{agentId:a.id,expectedVersion:0,settings,account},{Origin:'https://external.example'})).status,403);
 assert.equal((await post('/strategy-save',{agentId:a.id,expectedVersion:0,settings,account},{'X-Pumpcoin-Demo-Token':'wrong'})).status,403);
 assert.equal((await post('/strategy-save',{agentId:a.id,expectedVersion:0,settings,account,endpoint:'https://remote.example'})).status,400);
 const rejected=await post('/strategy-save',{agentId:a.id,expectedVersion:0,settings,account:'other.testnet'});assert.equal(rejected.status,400);
 const saved=await post('/strategy-save',{agentId:a.id,expectedVersion:0,settings,account});
 assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.phase,'deploy');
 assert.equal(saved.body.plan.signerId,account);assert.equal(saved.body.plan.actions[0].params.deposit,factory.funding);
 assert.equal(api.agents.strategies.active(a.id),undefined);
 assert.equal((await post('/strategy-deployment',{agentId:a.id})).body.phase,'deploy');
 simulateDeployment(saved.body);
 const first=await post('/strategy-deployment',{agentId:a.id});
 assert.equal(first.body.phase,'active',JSON.stringify(first.body));const runId=first.body.run.id;
 assert.equal((await post('/strategy-action',{runId,action:'cycle'})).status,200);const updated=await (await fetch(base+'/status')).json() as any;assert.equal(updated.registry.strategyRuns[0].activity.decisions,1);assert.equal(updated.registry.strategyRuns[0].activity.holds,1);
 const second=await post('/strategy-save',{agentId:a.id,expectedVersion:1,settings:{...settings,label:'Second'},account});
 assert.equal(second.body.phase,'deploy',JSON.stringify(second.body));
 assert.equal(second.body.plan.actions[0].params.args.previous_vault,saved.body.contractId);
 assert.equal(api.agents.strategies.active(a.id)?.id,runId);
 simulateDeployment(second.body);
 assert.equal((await post('/strategy-deployment',{agentId:a.id})).body.phase,'archive');
 assert.equal(api.agents.strategies.active(a.id)?.id,runId);
 deployed.get(saved.body.contractId).archived=true;
 deployed.get(saved.body.contractId).paused=true;
 assert.equal((await post('/strategy-deployment',{agentId:a.id})).body.phase,'open');
 deployed.get(second.body.contractId).public=true;
 const active=await post('/strategy-deployment',{agentId:a.id});
 assert.equal(active.body.phase,'active',JSON.stringify(active.body));
 assert.equal((await post('/strategy-action',{runId,action:'cycle'})).status,400);
 assert.equal((await post('/start',{id:first.body.run.sessionId})).status,400);
 assert.equal(api.vaults.list().find(v=>v.runId===runId)?.archived,true);
 assert.equal((await post('/vault-plan',{agentId:a.id,runId,account,action:'deposit',amount:'1000000'})).status,400);
 assert.equal((await post('/strategy-history',{runId})).body.events.length,2);assert.equal((await post('/strategy-export',{runId})).body.bundle.paper.replay.events,2);assert.equal((await post('/strategy-action',{runId,action:'broadcast'})).status,400);
 }finally{api.close();server.close();await once(server,'close');store.close();}
});
test('long local model warm-up can renew only its still-valid portfolio lease',()=>{
 const store=new DemoStore(':memory:'),paper=new PaperDemo(store),s=paper.create(config);try{const token=store.acquire(s.id);store.db.prepare('UPDATE sessions SET expires=? WHERE id=?').run(Date.now()+1000,s.id);store.renew(s.id,token);const row=store.db.prepare('SELECT expires FROM sessions WHERE id=?').get(s.id) as {expires:number};assert.ok(row.expires>Date.now()+290000);assert.throws(()=>store.renew(s.id,'foreign-token'),/expired or changed/);store.db.prepare('UPDATE sessions SET expires=0 WHERE id=?').run(s.id);assert.throws(()=>store.renew(s.id,token),/expired or changed/);store.release(s.id,token);}finally{paper.close();store.close();}
});
