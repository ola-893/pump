import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, link, mkdir, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ModelInventory } from '../near-demo/inventory.js';
import { parseCandles, researchWindow, fetchMarketHistory, type MarketDataset, type Candle } from '../near-demo/market-history.js';
import { historicalFill, liquidation, decisionIndexes, appendStep, historicalDecision, BENCHMARK_POLICY, type BenchmarkResult } from '../near-demo/benchmark.js';
import { NearAgents } from '../near-demo/agents.js';
import { DemoStore } from '../near-demo/store.js';
import { PaperDemo } from '../near-demo/service.js';
import { digest } from '../near-demo/ledger.js';
import { infer } from '../near-demo/model.js';
import type { Session } from '../near-demo/types.js';
const start=Date.UTC(2026,8,1);
const bars=Array.from({length:720},(_,i)=>({openAt:start+i*3600000,closeAt:start+(i+1)*3600000-1,open:'4.00000000',high:'4.10000000',low:'3.90000000',close:'4.00000000',volume:'1234.56780000',trades:100}));
const data:MarketDataset={version:'PUMPCOIN-NEAR-MARKET-v1',id:'test',source:'Binance public spot',symbol:'NEARUSDT',interval:'1h',capturedAt:new Date(start+720*3600000).toISOString(),url:'https://data-api.binance.vision/api/v3/klines',bars,scope:'Historical fixture, never live evidence'};
const raw=(b:Candle)=>[b.openAt,b.open,b.high,b.low,b.close,b.volume,b.closeAt,'0',b.trades];
test('discovery reads GGUFs in place, deduplicates hardlinks and rejects non-model/projector files',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'near-inventory-')),file=join(dir,'Qwen-Q4_K_M.gguf');await writeFile(file,Buffer.concat([Buffer.from('GGUF'),Buffer.alloc(100)]));await link(file,join(dir,'duplicate.gguf'));await writeFile(join(dir,'invalid.gguf'),'not GGUF, definitely not weights');await writeFile(join(dir,'mmproj-Q4.gguf'),Buffer.concat([Buffer.from('GGUF'),Buffer.alloc(100)]));
  const inventory=new ModelInventory([dir],join(dir,'absent'));const found=await inventory.scan();assert.equal(found.length,1);assert.equal(found[0].copies,2);assert.equal(found[0].bytes,104);assert.ok(!JSON.stringify(found).includes(dir));const measured=await inventory.measure(found[0].id);assert.match(measured.sha256,/^[a-f0-9]{64}$/);await writeFile(file,'GGUF changed weights with a different length');await assert.rejects(inventory.unchanged(measured.path,measured.stamp),/changed/);
});
test('market parser rejects invalid prices, missing intervals and unfinished candles',()=>{
  const now=start+3*3600000;assert.equal(parseCandles(bars.slice(0,4).map(raw),now).length,3);
  assert.throws(()=>parseCandles([raw(bars[0]),raw(bars[2])],now),/gaps/);
  const broken=raw(bars[0]);broken[2]='1.00';assert.throws(()=>parseCandles([broken],now),/prices/);
  const reversed=raw(bars[0]);reversed[6]=start-1;assert.throws(()=>parseCandles([reversed],now),/timing/);
});
test('research windows prevent future candle leakage and retain broad daily history in bounded prompts',()=>{
  const through=600,window=researchWindow(data,through);assert.equal(window.hourly.length,24);assert.equal(window.availableClosedHourlyBars,601);assert.ok(window.hourly.every(b=>b[0]<=bars[through].openAt));assert.ok(window.daily.every(b=>b[0]+86400000-1<=bars[through].closeAt));assert.ok(window.daily.length>=24);assert.throws(()=>researchWindow(data,720),/cutoff/);
  const indexes=decisionIndexes(data);assert.equal(indexes.length,24);assert.ok(indexes.every((i,n)=>i>=48&&i+24<data.bars.length&&(n===0||i-indexes[n-1]===24)));
});
test('market history errors never synthesize an alternate dataset',async()=>{
  await assert.rejects(fetchMarketHistory((async()=>new Response('blocked',{status:451})) as typeof fetch),/No synthetic fallback/);
  await assert.rejects(fetchMarketHistory((async()=>new Response(JSON.stringify(bars.slice(0,20).map(raw)))) as typeof fetch,start+720*3600000),/600/);
});
test('historical fills enforce caps and preserve capital/cost accounting through friction and partial exits',()=>{
  const initial={cash:'100000000',position:'0',cost:'0',realized:'0'};
  const proposal={action:'BUY' as const,quoteUnits:'20000000',reason:'Fixture input, not model performance'};
  assert.equal(historicalFill(initial,{...proposal,quoteUnits:'20000001'},bars[0]).status,'blocked');
  assert.equal(historicalFill(initial,{...proposal,action:'SELL'},bars[0]).status,'blocked');
  const buy=historicalFill(initial,proposal,bars[0]);assert.equal(buy.status,'fill');assert.equal(buy.wallet.cash,'80000000');assert.equal(buy.wallet.cost,'20000000');assert.ok(liquidation(buy.wallet,bars[0])<100000000n);
  const partial=historicalFill(buy.wallet,{...proposal,action:'SELL',quoteUnits:'10000000'},bars[1]);assert.ok(BigInt(partial.wallet.position)>0n&&BigInt(partial.wallet.position)<BigInt(buy.wallet.position));
  assert.equal(BigInt(partial.wallet.cash)+BigInt(partial.wallet.cost)-100000000n,BigInt(partial.wallet.realized));
  const sold=historicalFill(partial.wallet,{...proposal,action:'SELL'},bars[2]);assert.equal(sold.wallet.position,'0');assert.equal(sold.wallet.cost,'0');assert.ok(BigInt(sold.wallet.cash)<100000000n);assert.equal(BigInt(sold.wallet.cash)-100000000n,BigInt(sold.wallet.realized));
  assert.equal(historicalFill(initial,{action:'HOLD',quoteUnits:'0',reason:'No edge'},bars[0]).wallet,initial);
});
test('historical requests use the exact registered alias and contain no next-bar data',async()=>{
  let sent:any;const wallet={cash:'100000000',position:'0',cost:'0',realized:'0'};
  await historicalDecision('http://127.0.0.1:8093','bound-id','fixture strategy',wallet,data,143,(async(_url,opts)=>{sent=JSON.parse(String(opts?.body));return new Response(JSON.stringify({model:'bound-id',choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'HOLD',quoteUnits:'0',reason:'No edge'})}}]}));}) as typeof fetch);
  assert.equal(sent.model,'bound-id');const input=JSON.parse(sent.messages[1].content);assert.equal(input.market.through,new Date(bars[143].closeAt).toISOString());assert.ok(!JSON.stringify(input.market.hourly).includes(String(bars[144].openAt)));
});
test('registered live sessions refuse a different running model',async()=>{
  const s={config:{endpoint:'http://127.0.0.1:8093'},agent:{id:'agent',modelId:'expected',weightsHash:'abc'}} as Session;
  await assert.rejects(infer(s,{} as any,(async()=>new Response(JSON.stringify({data:[{id:'wrong'}]}))) as typeof fetch),/does not match/);
});
test('comparison checkpoints are hash linked and retain blocked or error observations',()=>{
  const result:BenchmarkResult={agentId:'a',modelId:'m',commitment:'c',state:'running',steps:[],wallet:{cash:'100000000',position:'0',cost:'0',realized:'0'},equity:'100000000',peak:'100000000',maxDrawdownBps:0,returnBps:0};
  for(const equity of ['99000000','101000000'])appendStep(result,{at:new Date().toISOString(),through:143,modelId:'m',status:'error',reason:'Unavailable inference; no fill',wallet:result.wallet,equity});
  assert.equal(result.steps[1].previousHash,result.steps[0].hash);for(const {hash,...body} of result.steps)assert.equal(hash,digest(body));assert.equal(result.maxDrawdownBps,100);assert.equal(result.returnBps,100);
});
test('unfinished comparisons become interrupted on restart instead of silently resuming',async()=>{
  const store=new DemoStore(':memory:'),paper=new PaperDemo(store),agents=new NearAgents(paper);
  store.db.prepare('INSERT INTO near_comparisons(id,body) VALUES(?,?)').run('run',JSON.stringify({id:'run',datasetId:'x',createdAt:new Date().toISOString(),state:'running',policy:BENCHMARK_POLICY,results:[{state:'running'}]}));
  const restarted=new NearAgents(paper);assert.equal(restarted.runs()[0].state,'interrupted');assert.equal(restarted.runs()[0].results[0].state,'interrupted');await agents.close();await restarted.close();store.close();
});
test('comparison export replays every balance and rejects edited inputs, costs and future leakage',async()=>{
  const {verifyComparison}=await import('../near-demo/benchmark.js');
  const {id:_id,...body}=data,measured={...data,id:digest(body)};
  const result:BenchmarkResult={agentId:'fixture-agent',modelId:'fixture-model',commitment:'fixture',state:'running',steps:[],wallet:{cash:'100000000',position:'0',cost:'0',realized:'0'},equity:'100000000',peak:'100000000',maxDrawdownBps:0,returnBps:0};
  for(const [i,through] of decisionIndexes(measured).entries()){
    const proposal={action:i%2?'SELL' as const:'BUY' as const,quoteUnits:'20000000',reason:'Test fixture only'},raw=JSON.stringify(proposal);
    const request={model:'fixture-model',messages:[{content:'fixture'},{content:JSON.stringify({wallet:result.wallet,market:researchWindow(measured,through),mandate:BENCHMARK_POLICY})}]};
    const filled=historicalFill(result.wallet,proposal,measured.bars[through+1]);appendStep(result,{at:new Date(measured.bars[through+1].openAt).toISOString(),through,modelId:'fixture-model',request,raw,proposal,...filled,equity:String(liquidation(filled.wallet,measured.bars[through+24]))});
  }
  result.state='complete';const run={id:'run',createdAt:new Date().toISOString(),datasetId:measured.id,policy:BENCHMARK_POLICY,state:'complete' as const,results:[result]};
  assert.equal(verifyComparison(run,measured).decisions,24);
  const tampered=structuredClone(run);tampered.results[0].wallet={...tampered.results[0].wallet,cash:'200000000'};assert.throws(()=>verifyComparison(tampered,measured),/accounting/);
  const future=structuredClone(run);(future.results[0].steps[0].request as any).messages[1].content=JSON.stringify({wallet:result.wallet,market:researchWindow(measured,144),mandate:BENCHMARK_POLICY});assert.throws(()=>verifyComparison(future,measured),/hash/);
  const market=structuredClone(measured);market.bars[0].close='900';assert.throws(()=>verifyComparison(run,market),/hash/);
  const declaration={id:'fixture-agent',manifest:{model:{id:'fixture-model'},strategy:{description:'Committed fixture mandate'}},commitment:''};
  declaration.commitment=digest(declaration.manifest);
  const declared=structuredClone(run);declared.results[0].commitment=declaration.commitment;
  const rehash=(candidate:typeof run,strategy:string)=>{let previousHash:string|null=null;for(const step of candidate.results[0].steps){
    const request=step.request as any,input=JSON.parse(request.messages[1].content);input.strategy=strategy;request.messages[1].content=JSON.stringify(input);
    step.previousHash=previousHash;const {hash,...body}=step;step.hash=digest(body);previousHash=step.hash;
  }};
  rehash(declared,declaration.manifest.strategy.description);
  assert.equal(verifyComparison(declared,measured,[declaration]).declarationsChecked,true);
  rehash(declared,'A substituted fixture mandate');
  assert.throws(()=>verifyComparison(declared,measured,[declaration]),/committed mandate/);

});
test('a second observer does not interrupt an active comparison owned by a live service',async()=>{
  const store=new DemoStore(':memory:'),paper=new PaperDemo(store),agents=new NearAgents(paper);
  store.db.prepare('INSERT INTO near_comparisons(id,body) VALUES(?,?)').run('active',JSON.stringify({ownerPid:process.pid,id:'active',datasetId:'x',createdAt:new Date().toISOString(),state:'running',policy:BENCHMARK_POLICY,results:[]}));
  const observer=new NearAgents(paper);assert.equal(observer.runs()[0].state,'running');await assert.rejects(observer.compare(['a','b']),/already running/);await agents.close();await observer.close();store.close();
});
test('live prompts retain broad history while bounding raw candle and route-quote samples',async()=>{
  const {liveContext}=await import('../near-demo/live-context.js');
  const samples=Array.from({length:20},(_,i)=>({quoteId:String(i),observedAt:new Date(start+i*1000).toISOString(),receivedAt:new Date(start+i*1000).toISOString(),inputUSDC:'1000000',outputWNEAR:String(1000000+i)}));
  const compact=liveContext({version:'PUMPCOIN-QUOTE-CONTEXT-v1',source:'replay',samples,sampleCount:20,spanMs:19000,outputChangeBps:0,scope:'Fixture'},data);
  assert.equal(compact.sampleCount,6);assert.equal(compact.samples[0].quoteId,'14');assert.equal(compact.spanMs,5000);assert.equal(compact.research.hourly.length,12);assert.equal(compact.research.daily.length,14);assert.equal(compact.research.fullRangeSummary.closedHourlyBars,720);assert.equal(compact.research.fullRangeSummary.through,new Date(bars.at(-1)!.closeAt).toISOString());
});

test('Hugging Face file symlinks are detected without copying, while split shards are excluded',async()=>{
  const root=await mkdtemp(join(tmpdir(),'near-symlink-')),blobs=join(root,'blobs'),snapshots=join(root,'snapshots');await mkdir(blobs);await mkdir(snapshots);const blob=join(blobs,'content-addressed');await writeFile(blob,Buffer.concat([Buffer.from('GGUF'),Buffer.alloc(100)]));await symlink(blob,join(snapshots,'Qwen-IQ4_XS.gguf'));await writeFile(join(snapshots,'split-00001-of-00002.gguf'),Buffer.concat([Buffer.from('GGUF'),Buffer.alloc(100)]));
  const inventory=new ModelInventory([snapshots],join(root,'absent'));const models=await inventory.scan();assert.equal(models.length,1);assert.equal(models[0].name,'Qwen');assert.equal(models[0].filename,'Qwen-IQ4_XS.gguf');assert.equal(models[0].quantization,'IQ4_XS');const measured=await inventory.measure(models[0].id);assert.equal(measured.path,await realpath(blob));
});
