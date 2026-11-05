import { randomUUID } from 'node:crypto';
import { ModelInventory } from './inventory.js';
import { LocalRuntime } from './runtime.js';
import { fetchMarketHistory, type MarketDataset } from './market-history.js';
import { BENCHMARK_POLICY, verifyComparison, appendStep, decisionIndexes, historicalDecision, historicalFill, liquidation, type BenchmarkRun } from './benchmark.js';
import { canonical, digest } from './ledger.js';
import { exerciseGuidance } from './exercise.js';
import { StrategyRuns } from './strategy-runs.js';
import { inferClassifier } from './classifier.js';
import { infer } from './model.js';
import { liveContext } from './live-context.js';
import { marketContext } from './market-context.js';
import { liveQuotes } from './quotes.js';
import { marketObservationSize, paperMarket } from './types.js';
import { testAccount, validateConfig } from './types.js';
import type { PaperDemo } from './service.js';
import type { AgentManifest } from './public-types.js';
export type { AgentManifest };
export type AgentRecord={id:string;createdAt:string;manifest:AgentManifest;commitment:string;sessionId:string;visibility?:'private'|'public';visibilityUpdatedAt?:string;publicListingRemoval?:{at:string;reason:string;replacementAgentId:string};local:{modelId:string;path:string;stamp:string;revalidatedAt?:string}};
export const SHARED_STRATEGY='Use the supplied closed NEAR candles to assess momentum, volatility and volume. Build an unleveraged spot position when the recent trend and volume support it; reduce exposure when the trend weakens. Explain the signal. Protect capital and HOLD when the evidence does not support a trade.';
export class NearAgents {
  readonly inventory=new ModelInventory();readonly runtime=new LocalRuntime();
  private active?:BenchmarkRun;private closing=false;private registering=false;private cancelRequested=false;private dataset?:MarketDataset;
  readonly paper:PaperDemo;
  readonly strategies:StrategyRuns;
  constructor(paper:PaperDemo){
    this.paper=paper;
    this.strategies=new StrategyRuns(paper,id=>this.read(id),()=>{
      const row=paper.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='near_continuous'").get();
      const saved=row?paper.store.db.prepare('SELECT body FROM near_continuous WHERE id=1').get() as {body:string}|undefined:undefined;
      if(this.active||saved&&JSON.parse(saved.body).enabled)throw new Error('Stop execution practice or historical comparisons before running a strategy.');
    });
    paper.store.db.exec('CREATE TABLE IF NOT EXISTS near_agents(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS near_market(id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS near_comparisons(id TEXT PRIMARY KEY, body TEXT NOT NULL);');
    const saved=paper.store.db.prepare("SELECT body FROM near_market WHERE json_extract(body, '$.symbol')='NEARUSDT' ORDER BY rowid DESC LIMIT 1").get() as {body:string}|undefined;this.dataset=saved?JSON.parse(saved.body):undefined;
    for(const run of this.runs())if(run.state==='running'&&!this.ownerAlive(run.ownerPid)){run.state='interrupted';run.error='Local service restarted. Completed decisions are preserved; start a new comparison.';for(const r of run.results)if(r.state!=='complete')r.state='interrupted';this.saveRun(run);}
    paper.setInferenceProvider(async(s,market,fetcher,context)=>{
      if(!s.agent)return infer(s,market,fetcher,context);
      if(this.active)throw new Error('The shared comparison owns the local runtime. Wait for it to complete.');
      let a=this.read(s.agent.id);if(a.commitment!==digest(a.manifest)||a.manifest.model.sha256!==s.agent.weightsHash||a.local.modelId!==s.agent.modelId)throw new Error('Agent binding is inconsistent.');
      if(s.agent.strategyRunId)this.strategies.verify(s);
      const checked=await this.revalidateModel(a.id);
      if(checked.commitment!==a.commitment||checked.local.modelId!==a.local.modelId)throw new Error('Agent binding changed during model verification.');
      a=checked;
      const marketDefinition=paperMarket(s.config);
      const data=marketDefinition.candles?await this.market(false,marketDefinition.candles):null;
      return this.runtime.use({id:a.local.modelId,path:a.local.path,stamp:a.local.stamp},async()=>{
        // Warm-up may outlast a quote's validity. Record the actual fresh receipt used by inference.
        const current=await liveQuotes(fetch,Date.now,s.config.market).get(marketDefinition.quote,marketDefinition.base,marketObservationSize(s.config),s.config.slippageBps);
        const observed=marketContext(s,current,this.paper.store.recent(s.id));
        const input={...(data?liveContext(observed,data):observed),...(s.agent?.strategyRunId?{strategyVersion:{id:s.agent.strategyRunId,commitment:this.strategies.read(s.agent.strategyRunId).commitment}}:{executionExercise:exerciseGuidance(s,this.paper.store.history(s.id))})};
        const decision=await (a.manifest.inference.runtime==='clef-mlx'?inferClassifier(s,current,fetcher,input):infer(s,current,fetcher,input));
        await this.inventory.unchanged(a.local.path,a.local.stamp);
        return {...decision,market:current,runtime:this.runtime.describe()};
      });
    });
  }
  private ownerAlive(pid:number|undefined){if(!pid||!Number.isSafeInteger(pid))return false;try{process.kill(pid,0);return true;}catch(e){return (e as NodeJS.ErrnoException).code==='EPERM';}}
  records():AgentRecord[]{return (this.paper.store.db.prepare('SELECT body FROM near_agents ORDER BY rowid').all() as {body:string}[]).map(r=>JSON.parse(r.body));}
  read(id:string){const a=this.records().find(a=>a.id===id);if(!a)throw new Error('Agent registration not found on this local instance.');return a;}
  visibility(a:AgentRecord){return a.visibility??'public';}
  assertPublic(id:string){let a:AgentRecord;try{a=this.read(id);}catch{throw new Error('Agent record unavailable.');}if(this.visibility(a)!=='public'||a.publicListingRemoval)throw new Error('Agent record unavailable.');return a;}
  assertPublicSession(id:string){const a=this.records().find(a=>a.sessionId===id),r=this.strategies.records().find(r=>r.sessionId===id);if(!a&&!r)throw new Error('Agent record unavailable.');return this.assertPublic(a?.id??r!.agentId);}
  setVisibility(id:string,visibility:'private'|'public',expected:'private'|'public'){
    if(!['private','public'].includes(visibility)||!['private','public'].includes(expected))throw new Error('Choose private or public.');
    const row=this.paper.store.db.prepare('SELECT body FROM near_agents WHERE id=?').get(id) as {body:string}|undefined;if(!row)throw new Error('Agent registration not found.');
    const a=JSON.parse(row.body) as AgentRecord;if(this.visibility(a)!==expected)throw new Error('Agent visibility changed. Refresh before updating it.');
    if(a.commitment!==digest(a.manifest))throw new Error('Agent registration commitment is inconsistent.');
    if(visibility===expected)return this.publicRecord(a);
    if(this.visibility(a)==='public')throw new Error('Public agents stay public. Publication cannot be reversed.');
    const next={...a,visibility,visibilityUpdatedAt:new Date().toISOString()};
    if(this.paper.store.db.prepare('UPDATE near_agents SET body=? WHERE id=? AND body=?').run(canonical(next),id,row.body).changes!==1)throw new Error('Agent changed. Refresh before updating visibility.');
    return this.publicRecord(next);
  }
  publicStatus(){
    const records=this.records().filter(a=>this.visibility(a)==='public'&&!a.publicListingRemoval),ids=new Set(records.map(a=>a.id));
    const stripEndpoint=(s:ReturnType<PaperDemo['view']>)=>{const {endpoint:_endpoint,...config}=s.config;return {...s,config};};
    return {agents:records.map(a=>{const r=this.publicRecord(a);return {...r,session:stripEndpoint(r.session)};}),strategyRuns:this.strategies.records().filter(r=>ids.has(r.agentId)).map(r=>{const v=this.strategies.view(r),{endpoint:_endpoint,...config}=v.config;return {...v,config,session:stripEndpoint(v.session)};}),
      execution:{activeId:null,queued:[]},models:[],measurement:null,runtime:{modelId:null,phase:'idle'},continuous:null,
      comparisons:this.runs().filter(r=>r.results.every(x=>ids.has(x.agentId))).map(({ownerPid:_ownerPid,...r})=>({...r,results:r.results.map(({runtime:_runtime,...x})=>({...x,steps:x.steps.map(({request:_request,raw:_raw,...step})=>step)}))})),
      market:this.dataset?{id:this.dataset.id,source:this.dataset.source,symbol:this.dataset.symbol,count:this.dataset.bars.length,from:this.dataset.bars[0].openAt,through:this.dataset.bars.at(-1)!.closeAt,capturedAt:this.dataset.capturedAt,stale:Date.now()-this.dataset.bars.at(-1)!.closeAt>7200000}:null,policy:BENCHMARK_POLICY};
  }
  async revalidateModel(id:string):Promise<AgentRecord>{
    const row=this.paper.store.db.prepare('SELECT body FROM near_agents WHERE id=?').get(id) as {body:string}|undefined;
    if(!row)throw new Error('Agent registration not found on this local instance.');
    const a=JSON.parse(row.body) as AgentRecord;
    if(a.commitment!==digest(a.manifest))throw new Error('Agent registration commitment is inconsistent.');
    const nextStamp=await this.inventory.revalidate(a.local.path,a.local.stamp,a.manifest.model.sha256);
    if(nextStamp===a.local.stamp)return a;
    const next={...a,local:{...a.local,stamp:nextStamp,revalidatedAt:new Date().toISOString()}};
    const result=this.paper.store.db.prepare('UPDATE near_agents SET body=? WHERE id=? AND body=?').run(canonical(next),id,row.body);
    if(result.changes!==1){
      const latest=this.read(id);
      if(latest.commitment===a.commitment&&latest.local.path===a.local.path&&latest.local.modelId===a.local.modelId&&latest.local.stamp===nextStamp)return latest;
      throw new Error('Agent local binding changed during verification. Try again.');
    }
    return next;
  }
  publicRecord(a:AgentRecord){const {local:_local,...record}=a;const stored=this.paper.store.read(a.sessionId),session=this.paper.view(stored),events=this.paper.store.history(a.sessionId),decisions=events.filter(e=>e.kind==='model'&&['live-local-model','operator-directed-model'].includes(e.evidence)),latest=decisions.at(-1);return {...record,visibility:this.visibility(a),modelRevalidatedAt:a.local.revalidatedAt??null,session,exercise:exerciseGuidance(stored,events),activity:{buys:events.filter(e=>e.kind==='fill'&&e.action==='BUY').length,sells:events.filter(e=>e.kind==='fill'&&e.action==='SELL').length,decisions:decisions.length,directed:events.some(e=>e.evidence==='operator-directed-model'),directedFills:events.filter(e=>e.kind==='fill'&&e.evidence==='operator-directed-model').length,holds:events.filter(e=>e.kind==='hold'&&['live-local-model','operator-directed-model'].includes(e.evidence)).length,fills:events.filter(e=>e.kind==='fill'&&['live-local-model','operator-directed-model'].includes(e.evidence)).length,blocked:events.filter(e=>e.kind==='blocked').length,latest:latest?{at:latest.at,proposal:latest.model?.proposal}:null,manual:events.some(e=>e.evidence==='manual-scenario'),firstAt:events[0]?.at??null,lastAt:events.at(-1)?.at??null}};}
  runs():BenchmarkRun[]{return (this.paper.store.db.prepare('SELECT body FROM near_comparisons ORDER BY rowid DESC LIMIT 20').all() as {body:string}[]).map(r=>JSON.parse(r.body));}
  status(){return {strategyRuns:this.strategies.list(),agents:this.records().map(a=>this.publicRecord(a)),execution:this.paper.execution,models:this.inventory.list(),measurement:this.inventory.progress,runtime:this.runtime.state,comparisons:this.runs().map(run=>({...run,results:run.results.map(r=>({...r,steps:r.steps.map(({request:_request,raw:_raw,...step})=>step)}))})),market:this.dataset?{id:this.dataset.id,source:this.dataset.source,symbol:this.dataset.symbol,count:this.dataset.bars.length,from:this.dataset.bars[0].openAt,through:this.dataset.bars.at(-1)!.closeAt,capturedAt:this.dataset.capturedAt,stale:Date.now()-this.dataset.bars.at(-1)!.closeAt>7200000}:null,policy:BENCHMARK_POLICY};}
  startLive(ids:string[]){
    if(this.active)throw new Error('Stop the historical comparison before starting live paper trading.');
    if(!Array.isArray(ids)||!ids.length||ids.length>8||new Set(ids).size!==ids.length)throw new Error('Select one to eight different registered agents.');
    const records=ids.map(id=>this.read(id));
    for(const a of records)if(this.paper.store.read(a.sessionId).testnet?.settlementPrepared)throw new Error('A selected session is sealed for settlement.');
    return records.map(a=>this.paper.start(a.sessionId));
  }
  stopLive(){for(const s of this.paper.store.list())this.paper.stop(s.id);return {message:'Workers stopped. An active inference may finish; queued decisions are cancelled.'};}
  async requestExercise(ids:string[]){
    if(this.active||this.paper.busy||this.paper.list().some(s=>s.state==='running'))throw new Error('Stop workers and wait for the active decision before requesting an exercise.');
    if(!Array.isArray(ids)||!ids.length||ids.length>8||new Set(ids).size!==ids.length)throw new Error('Select one to eight different agents.');
    const records=ids.map(id=>this.read(id));
    for(const a of records)this.paper.checkExercise(a.sessionId);
    for(const a of records)await this.paper.requestExercise(a.sessionId);
    return records.map(a=>this.publicRecord(a));
  }
  async checkModel(id:string){
    if(this.active||this.paper.busy||this.paper.list().some(s=>s.state==='running'))throw new Error('Stop paper workers before checking a model.');
    const a=await this.revalidateModel(id);if(a.manifest.inference.runtime!=='clef-mlx')throw new Error('This check is for classifier agents.');
    return this.runtime.use({id:a.local.modelId,path:a.local.path,stamp:a.local.stamp},async()=>{
      try{
      const request={model:a.local.modelId,truncate:false,state:'This is a local model registration check. No trade is requested.',questions:{action:{type:'choice',instructions:'What does this state request?',criteria:{check:'A local registration check without a trade.',trade:'A request to buy or sell a token.'}}}};
      const samples=[];for(let n=0;n<2;n++){const start=Date.now(),r=await fetch(new URL('/v1/systemone',this.runtime.endpoint),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(180000)});const response=await r.json() as any;if(!r.ok||response.model!==a.local.modelId||response.usage?.output_tokens!==0||response.answers?.action?.choice!=='check')throw new Error('Classifier smoke check failed.');samples.push({elapsedMs:Date.now()-start,response});}
      await this.inventory.unchanged(a.local.path,a.local.stamp);
      return {agentId:id,model:a.manifest.model.id,runtime:this.runtime.describe(),samples,noTrading:true};
      }finally{await this.runtime.stop();}
    });
  }
  async register(input:{visibility?:'private'|'public';name:string;controller:string;modelId:string;strategy:string;tradeCap:string;exposureCap:string;dailyTurnoverCap:string;slippageBps:number;initialCash:string;intervalMs:number}){
    if(this.registering)throw new Error('Another registration is measuring weights. Wait for it to finish.');this.registering=true;
    try{
      if(!input||Object.keys(input).filter(k=>k!=='visibility').sort().join()!=='controller,dailyTurnoverCap,exposureCap,initialCash,intervalMs,modelId,name,slippageBps,strategy,tradeCap')throw new Error('Invalid registration fields.');
      if(input.visibility!==undefined&&!['private','public'].includes(input.visibility))throw new Error('Choose private or public visibility.');
      const controller=testAccount(input.controller),config=validateConfig({name:input.name,initialCash:input.initialCash,tradeCap:input.tradeCap,exposureCap:input.exposureCap,dailyTurnoverCap:input.dailyTurnoverCap,slippageBps:input.slippageBps,executionDelayMs:1500,maxQuoteAgeMs:30000,source:'live',endpoint:this.runtime.endpoint,strategy:input.strategy,intervalMs:input.intervalMs});
      if(config.strategy.trim().length<20)throw new Error('Describe the strategy and conditions for holding.');
      if(this.records().some(a=>a.manifest.controller===controller&&a.manifest.name.toLowerCase()===config.name.toLowerCase()))throw new Error('This controller already has an agent with this name. Choose another name or open its profile.');
      const m=await this.inventory.measure(input.modelId);
      const manifest:AgentManifest={version:'PUMPCOIN-NEAR-AGENT-v1',name:config.name,controller,network:'NEAR testnet',model:{id:m.name,filename:m.filename,bytes:m.bytes,sha256:m.sha256,quantization:m.quantization},inference:{policy:'self-hosted-only',runtime:m.runtime??'llama.cpp',context:4096,attestation:'none'},strategy:{description:config.strategy,pair:'wNEAR / USDC',tradeCap:config.tradeCap,exposureCap:config.exposureCap,dailyTurnoverCap:config.dailyTurnoverCap,slippageBps:config.slippageBps,intervalMs:config.intervalMs},mode:'paper trading; optional Circle testnet clearing',evidence:'locally measured weights; unsigned local declaration'};
      const id=randomUUID(),session=this.paper.create(config),a:AgentRecord={id,createdAt:new Date().toISOString(),manifest,commitment:digest(manifest),sessionId:session.id,visibility:input.visibility??'private',local:{modelId:m.id,path:m.path,stamp:m.stamp}};
      const token=this.paper.store.acquire(session.id);try{this.paper.store.save({...this.paper.store.read(session.id),agent:{id,modelId:m.id,weightsHash:m.sha256}},token);}finally{this.paper.store.release(session.id,token);}
      this.paper.store.db.prepare('INSERT INTO near_agents(id,body) VALUES(?,?)').run(id,canonical(a));return this.publicRecord(a);
    }finally{this.registering=false;}
  }
  async market(force=false,symbol:MarketDataset['symbol']='NEARUSDT'){
    const db=this.paper.store.db;
    const saved=symbol==='NEARUSDT'?this.dataset:JSON.parse((db.prepare("SELECT body FROM near_market WHERE json_extract(body, '$.symbol')=? ORDER BY rowid DESC LIMIT 1").get(symbol) as {body:string}|undefined)?.body??'null') as MarketDataset|null;
    if(saved&&!force&&Date.now()-saved.bars.at(-1)!.closeAt<7200000)return saved;
    const data=await fetchMarketHistory(fetch,Date.now(),symbol);
    db.prepare('INSERT OR IGNORE INTO near_market(id,body) VALUES(?,?)').run(data.id,canonical(data));
    if(symbol==='NEARUSDT')this.dataset=data;
    return data;
  }
  private saveRun(run:BenchmarkRun){this.paper.store.db.prepare('INSERT INTO near_comparisons(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(run.id,canonical(run));}
  async compare(ids:string[]){
    if(this.active||this.runs().some(r=>r.state==='running'&&this.ownerAlive(r.ownerPid)))throw new Error('A shared comparison is already running.');
    if(!Array.isArray(ids)||ids.length<2||ids.length>8||new Set(ids).size!==ids.length)throw new Error('Select between two and eight different agents.');
    const agents=ids.map(id=>this.read(id));if(agents.some(a=>a.manifest.inference.runtime==='clef-mlx'))throw new Error('Classifier agents use saved live paper strategies; the historical chat-model comparison is not supported.');if(this.paper.busy||this.paper.list().some(s=>s.state==='running'))throw new Error('Stop paper workers and wait for the active decision before starting a shared comparison.');
    const run:BenchmarkRun={ownerPid:process.pid,id:randomUUID(),datasetId:'',createdAt:new Date().toISOString(),state:'running',policy:BENCHMARK_POLICY,results:agents.map(a=>({agentId:a.id,modelId:a.manifest.model.id,commitment:a.commitment,state:'queued',steps:[],wallet:{cash:BENCHMARK_POLICY.startingCash,position:'0',cost:'0',realized:'0'},equity:BENCHMARK_POLICY.startingCash,peak:BENCHMARK_POLICY.startingCash,maxDrawdownBps:0,returnBps:0}))};
    this.cancelRequested=false;this.active=run;this.saveRun(run);
    void this.execute(run,agents).catch(()=>{});return run;
  }
  private async execute(run:BenchmarkRun,agents:AgentRecord[]){
    try{
      const data=await this.market(true);run.datasetId=data.id;this.saveRun(run);const indexes=decisionIndexes(data);
      for(let a=0;a<agents.length;a++){
        const agent=await this.revalidateModel(agents[a].id),result=run.results[a];if(agent.commitment!==agents[a].commitment||agent.local.modelId!==agents[a].local.modelId)throw new Error('Comparison binding changed during model verification.');result.state='running';this.saveRun(run);
        await this.runtime.use({id:agent.local.modelId,path:agent.local.path,stamp:agent.local.stamp},async()=>{
          result.runtime=this.runtime.describe();this.saveRun(run);
          for(const through of indexes){await this.inventory.unchanged(agent.local.path,agent.local.stamp);if(this.closing||this.cancelRequested)throw new Error('Comparison interrupted by operator request or local shutdown.');
            const next=data.bars[through+1],mark=data.bars[Math.min(through+24,data.bars.length-1)];
            try{
              const decision=await historicalDecision(this.runtime.endpoint,agent.local.modelId,agent.manifest.strategy.description,result.wallet,data,through);
              await this.inventory.unchanged(agent.local.path,agent.local.stamp);
              const filled=historicalFill(result.wallet,decision.proposal,next);
              appendStep(result,{at:new Date(next.openAt).toISOString(),through,modelId:decision.id,request:decision.request,raw:decision.raw,proposal:decision.proposal,...filled,equity:String(liquidation(filled.wallet,mark))});
            }catch(e){appendStep(result,{at:new Date(next.openAt).toISOString(),through,modelId:agent.local.modelId,status:'error',reason:e instanceof Error?e.message:'Inference failed; no fill assumed.',wallet:result.wallet,equity:String(liquidation(result.wallet,mark))});}
            this.saveRun(run);
          }
        });result.state='complete';this.saveRun(run);
      }
      run.state='complete';run.finishedAt=new Date().toISOString();
    }catch(e){run.state='interrupted';run.error=e instanceof Error?e.message:'Comparison failed.';for(const r of run.results)if(r.state!=='complete')r.state='interrupted';}
    finally{this.saveRun(run);this.active=undefined;await this.runtime.stop();}
  }
  stopComparison(){if(!this.active)throw new Error('No comparison is running.');this.cancelRequested=true;return {message:'Stop requested. The current inference will finish, then the comparison stops.'};}
  export(id:string){const a=this.read(id),runs=this.runs().filter(r=>r.results.some(x=>x.agentId===id));return {strategyRuns:this.strategies.records().filter(r=>r.agentId===id).map(r=>this.strategies.export(r.id)),version:'PUMPCOIN-NEAR-AGENT-EXPORT-v1',agent:this.publicRecord(a),paper:this.paper.store.export(a.sessionId),comparisons:runs.map(run=>{const dataset=JSON.parse((this.paper.store.db.prepare('SELECT body FROM near_market WHERE id=?').get(run.datasetId) as {body:string}|undefined)?.body??'null') as MarketDataset|null;const declarations=run.results.map(r=>{const record=this.read(r.agentId);if(record.commitment!==r.commitment)throw new Error('Comparison declaration changed.');return {id:record.id,manifest:record.manifest,commitment:record.commitment};});return {run,dataset,replay:dataset?verifyComparison(run,dataset,declarations):null,declarations};}),boundary:'Unsigned local registration and local model execution. Hashes provide consistency checks, not independent attestation. Historical comparisons are hypothetical USDT accounting. Live paper sessions use dry-run USDC quotes. No mainnet trading.'};}
  async close(){this.closing=true;await this.runtime.close();}
}
