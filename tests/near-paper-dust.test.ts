import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoStore} from '../near-demo/store.js';
import {PaperDemo} from '../near-demo/service.js';
import {digest,isPaperDust,retirePaperDust,verifyHistory} from '../near-demo/ledger.js';
import {USDC,WNEAR,type Config,type Event,type Quote} from '../near-demo/types.js';
const config:Config={name:'Rounding fixture',initialCash:'100000000',tradeCap:'10000000',exposureCap:'30000000',dailyTurnoverCap:'60000000',slippageBps:50,executionDelayMs:1000,maxQuoteAgeMs:30000,source:'replay',endpoint:'http://127.0.0.1:8093/v1',strategy:'Named test fixture only, never actual model evidence.',intervalMs:60000};
function fixture(){
 let now=Date.parse('2026-11-03T00:00:00Z'),sell=false,exitRequests=0;
 const store=new DemoStore(':memory:');
 const paper=new PaperDemo(store,{now:()=>now++,delay:async()=>{},quotes:()=>({get:async(tokenIn,tokenOut,amountIn)=>{
  const amount=BigInt(amountIn);if(tokenIn===WNEAR){exitRequests++;if(amount<10n**18n)throw new Error('Fixture amount below route precision.');}
  const output=tokenIn===USDC?amount*10n**24n/5000000n:amount*9944005n/(2n*10n**24n);
  return {source:'replay',id:'named-quote-fixture',tokenIn,tokenOut,amountIn,amountOut:String(output),minimumOut:'0',observedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString(),signatureVerified:false,raw:{fixture:true}} as Quote;
 }}),infer:async()=>{const proposal={action:sell?'SELL' as const:'BUY' as const,quoteUnits:sell?'9944004':'10000000',reason:'Named rounding fixture, not real model output.'};return {id:'fixture',request:{},raw:JSON.stringify(proposal),proposal};}});
 const created=paper.create(config),lease=store.acquire(created.id),s=store.read(created.id);store.save({...s,agent:{id:'fixture-agent',modelId:'fixture',weightsHash:'fixture',strategyRunId:'fixture-run'}},lease);store.release(created.id,lease);
 return {store,paper,id:s.id,sell:()=>{sell=true;},requests:()=>exitRequests};
}
test('tiny post-sale residual becomes a replayable loss, never cash or a fake fill',async()=>{
 const f=fixture();try{
  await f.paper.cycle(f.id);f.sell();const result=await f.paper.cycle(f.id),events=f.store.history(f.id),dust=events.find(e=>e.kind==='dust')!;
  assert.ok(dust);assert.ok(BigInt(dust.before.position)>0n);assert.equal(dust.after.position,'0');assert.equal(dust.after.cost,'0');assert.equal(dust.before.cash,dust.after.cash);
  assert.equal(BigInt(dust.after.realized),BigInt(dust.before.realized)-BigInt(dust.before.cost));assert.equal(result.portfolio.equity,result.portfolio.cash);assert.equal(result.error,null);
  assert.equal(events.filter(e=>e.kind==='fill').length,2);assert.equal(result.turnover.used,'19944003');assert.equal(f.requests(),3);f.store.export(f.id);
  const exported=f.store.export(f.id),bad=structuredClone(exported.events),adjustment=bad.find(e=>e.kind==='dust')!;adjustment.dust!.saleHash='forged';const {hash,...body}=adjustment;adjustment.hash=digest(body);assert.throws(()=>verifyHistory(exported.session,bad),/dust receipt/);
 }finally{f.paper.close();f.store.close();}
});
test('dust retirement cannot erase normal positions, unrelated residues or testnet claims',async()=>{
 const f=fixture();try{
  await f.paper.cycle(f.id);f.sell();await f.paper.cycle(f.id);const events=f.store.history(f.id),dust=events.find(e=>e.kind==='dust')!,sale=events.filter(e=>e.kind==='fill').at(-1)!,s={...f.store.read(f.id),portfolio:dust.before};
  assert.equal(isPaperDust(s,sale),true);
  for(const changed of [{...s,agent:undefined},{...s,testnet:{account:'owner.testnet',initialClaim:'100000000'}},{...s,portfolio:{...s.portfolio,cost:'11'}},{...s,portfolio:{...s.portfolio,position:String(10n**18n+1n)}},{...s,portfolio:{...s.portfolio,cash:'1'}}])assert.equal(isPaperDust(changed,sale),false);
  assert.equal(isPaperDust(s,undefined),false);assert.equal(isPaperDust(s,{...sale,action:'BUY'}),false);assert.throws(()=>retirePaperDust({...s,agent:undefined},sale,Date.now()),/not an eligible/);
 }finally{f.paper.close();f.store.close();}
});
test('whole-position exit reuses its exact fresh quote and stays inside caps',async()=>{
 const f=fixture();try{
  await f.paper.cycle(f.id);const before=f.requests();f.paper.setInferenceProvider(async()=>{const proposal={action:'SELL' as const,quoteUnits:'10000000',reason:'Named whole-exit fixture'};return {id:'fixture',request:{},raw:JSON.stringify(proposal),proposal};});
  await f.paper.cycle(f.id);assert.equal(f.requests()-before,1);assert.equal(f.store.read(f.id).portfolio.position,'0');assert.equal(f.store.history(f.id).filter(e=>e.kind==='dust').length,0);f.store.export(f.id);
 }finally{f.paper.close();f.store.close();}
});

test('a residual from repeated partial exit legs qualifies by absolute quantity and value',()=>{
 const now=Date.parse('2026-11-03T08:00:00Z'),pos='259419455086127126',cost='2';
 const before={cash:'99809341',cost:'3998',realized:'-186661',position:'1027301042141063415401',equity:null,peak:'100000000',drawdownBps:null,maxDrawdownBps:19,markAt:null};
 const after={...before,cash:'99813299',cost,realized:'-186699',position:pos};
 const q={source:'replay',id:'repeated-partial-exit-fixture',tokenIn:WNEAR,tokenOut:USDC,amountIn:'1027041622685977288275',amountOut:'3958',minimumOut:'0',signatureVerified:false,observedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString(),raw:{fixture:true}} as Quote;
 const sale={kind:'fill',action:'SELL',evidence:'live-local-model',sessionId:'fixture',before,after,at:new Date(now).toISOString(),quote:q} as Event;
 const s={id:'fixture',config,portfolio:after,agent:{strategyRunId:'fixture-run'}} as any;
 assert.equal(isPaperDust(s,sale),true);const retired=retirePaperDust(s,sale,now);assert.equal(retired.realized,'-186701');assert.equal(retired.cash,'99813299');assert.equal(retired.position,'0');
});
