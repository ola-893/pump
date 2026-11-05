import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DemoStore } from '../near-demo/store.js';
import { PaperDemo } from '../near-demo/service.js';
import { initialPortfolio, fill, mark, metrics, digest, freshQuote } from '../near-demo/ledger.js';
import { liveQuotes, scenarioQuotes } from '../near-demo/quotes.js';
import { IntentMarkets } from '../near-demo/intent-markets.js';
import { USDC,WNEAR,TEST_USDC,markets,validateConfig,type Config,type Session,type TestnetConfig } from '../near-demo/types.js';
import { TestnetDemo } from '../near-demo/testnet.js';
import { validateDemoPlan } from '../app/src/lib/near-demo-wallet.js';
import { infer } from '../near-demo/model.js';
import { marketContext } from '../near-demo/market-context.js';
import type { Event, Quote } from '../near-demo/types.js';

const config:Config={name:'Acceptance',initialCash:'20000000',tradeCap:'5000000',exposureCap:'15000000',dailyTurnoverCap:'100000000',slippageBps:100,executionDelayMs:1000,maxQuoteAgeMs:30000,source:'replay',endpoint:'http://127.0.0.1:8080/v1',strategy:'Protect capital',intervalMs:60000};
const create=(c:Partial<Config>={})=>{const store=new DemoStore(':memory:'),demo=new PaperDemo(store,{delay:async()=>{}}),view=demo.create({...config,...c});return {store,demo,id:view.id};};
const manual=(action:'BUY'|'SELL',quoteUnits='5000000')=>({action,quoteUnits,reason:'Manual acceptance scenario'});

test('24/6 decimal round trip realizes friction, reconciles and survives reopen',async()=>{
  const path=join(mkdtempSync(join(tmpdir(),'pumpcoin-near-')),'paper.sqlite');let store=new DemoStore(path);const demo=new PaperDemo(store,{delay:async()=>{}}),s=demo.create(config);
  const bought=await demo.cycle(s.id,manual('BUY'));assert.equal(bought.portfolio.cash,'15000000');assert.equal(bought.portfolio.position,'997000000000000000000000');
  const sold=await demo.cycle(s.id,manual('SELL'));assert.equal(sold.portfolio.position,'0');assert.equal(sold.portfolio.cash,'19970045');assert.equal(sold.metrics.total,'-29955');assert.equal(sold.metrics.realized,sold.metrics.total);assert.equal(sold.metrics.unrealized,'0');
  const exported=store.export(s.id);assert.equal(exported.replay.events,6);store.close();store=new DemoStore(path);assert.equal(store.export(s.id).session.portfolio.cash,'19970045');store.close();
});
test('oversized proposal and insufficient inventory never change balances',async()=>{const {demo,id,store}=create();const before=store.read(id).portfolio;await demo.cycle(id,manual('BUY','6000000'));assert.deepEqual(store.read(id).portfolio,before);await demo.cycle(id,manual('SELL'));assert.deepEqual(store.read(id).portfolio,before);assert.equal(store.history(id).filter(x=>x.kind==='fill').length,0);store.export(id);});
test('partial sales conserve allocated cost and realize no extra inventory',async()=>{const {demo,id,store}=create();await demo.cycle(id,manual('BUY'));await demo.cycle(id,manual('SELL','1000000'));const p=store.read(id).portfolio;assert.ok(BigInt(p.position)>0n);assert.ok(BigInt(p.cost)>0n&&BigInt(p.cost)<5000000n);assert.equal(BigInt(p.cash)+BigInt(p.cost)-20000000n,BigInt(p.realized));store.export(id);});
test('valuation replay remains exact when the clock advances between calculation and commit',async()=>{
  let time=Date.now();const store=new DemoStore(':memory:'),demo=new PaperDemo(store,{now:()=>time+=5,delay:async()=>{}}),s=demo.create(config);
  await demo.cycle(s.id,manual('BUY'));await demo.refresh(s.id);await demo.cycle(s.id,manual('SELL'));
  assert.equal(store.export(s.id).replay.events,7);
  for(const e of store.history(s.id).filter(e=>e.kind==='mark'))assert.equal(e.at,e.after.markAt);
});
test('turnover cap persists; further fill is blocked',async()=>{const {demo,id,store}=create({dailyTurnoverCap:'5000000'});await demo.cycle(id,manual('BUY'));const before=store.read(id).portfolio;await demo.cycle(id,manual('SELL'));assert.deepEqual(store.read(id).portfolio,before);assert.equal(store.read(id).turnover.used,'5000000');store.export(id);});
test('lost/stale marks are unavailable, not zero equity',async()=>{const {demo,id,store}=create();await demo.cycle(id,manual('BUY'));const s=store.read(id),q=await scenarioQuotes().get(WNEAR,USDC,s.portfolio.position,100);assert.equal(mark(s,undefined,Date.now()).equity,null);assert.throws(()=>freshQuote({...q,receivedAt:'2000-01-01T00:00:00Z'},s,Date.now()),/stale/);assert.throws(()=>mark(s,{...q,amountIn:'1'},Date.now()),/whole position/);});
test('failed live quote never falls back to synthetic activity',async()=>{const store=new DemoStore(':memory:'),demo=new PaperDemo(store,{quotes:()=>({get:async()=>{throw new Error('Unavailable quote');}}),delay:async()=>{}}),s=demo.create({...config,source:'live'});const result=await demo.cycle(s.id,manual('BUY'));assert.equal(result.portfolio.cash,config.initialCash);assert.equal(store.history(s.id).filter(x=>x.kind==='fill').length,0);});
test('a live cycle gets a signed quote through the default provider using the service clock',async t=>{
  const raw=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-dry-quote.json',import.meta.url),'utf8'));
  const now=()=>Date.parse(raw.timestamp);
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify(raw)));
  const store=new DemoStore(':memory:');
  const demo=new PaperDemo(store,{now,infer:async(_session,quote)=>{
    assert.equal(quote.receivedAt,raw.timestamp);
    assert.equal(quote.signatureVerified,true);
    return {id:'fixture',request:{},raw:'hold',proposal:{action:'HOLD',quoteUnits:'0',reason:'Test hold'}};
  }});
  try {
    const session=demo.create({...config,source:'live'});
    const result=await demo.cycle(session.id);
    assert.equal(result.error,null);
    assert.deepEqual(store.history(session.id).map(event=>event.kind),['model','hold']);
  } finally {demo.close();store.close();}
});
test('concurrent cycles cannot double-spend paper cash',async()=>{let release!:()=>void;const waiting=new Promise<void>(r=>release=r),store=new DemoStore(':memory:'),demo=new PaperDemo(store,{delay:()=>waiting}),s=demo.create(config);const first=demo.cycle(s.id,manual('BUY'));await new Promise(r=>setTimeout(r,5));await assert.rejects(demo.cycle(s.id,manual('BUY')),/owns/);release();await first;assert.equal(store.read(s.id).portfolio.cash,'15000000');});
test('tampered journal event is rejected by replay',async()=>{const {demo,id,store}=create();await demo.cycle(id,manual('BUY'));const e=store.history(id)[1];e.after.cash='99999999';store.db.prepare('UPDATE events SET body=? WHERE session=? AND sequence=?').run(JSON.stringify(e),id,e.sequence);assert.throws(()=>store.export(id),/inconsistent/);});
test('signed 1Click fixture verifies, binds amounts and request is hardwired dry-only',async()=>{
  const raw=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-dry-quote.json',import.meta.url),'utf8'));let request:any;
  const provider=liveQuotes((async(url,opts)=>{assert.equal(url,'https://1click.chaindefuser.com/v0/quote');request=JSON.parse(String(opts?.body));return new Response(JSON.stringify(raw),{status:201});}) as typeof fetch,()=>Date.parse(raw.timestamp));
  const q=await provider.get(USDC,WNEAR,'1000000',100);assert.equal(request.dry,true);assert.equal(q.signatureVerified,true);
  const s={config:{...config,source:'live'}} as Session;freshQuote(q,s,Date.parse(raw.timestamp));assert.throws(()=>freshQuote({...q,amountOut:String(BigInt(q.amountOut)+1n)},s,Date.parse(raw.timestamp)),/binding/);
  const tampered=structuredClone(raw);tampered.quote.amountOut='99999999';await assert.rejects(liveQuotes((async()=>new Response(JSON.stringify(tampered))) as typeof fetch).get(USDC,WNEAR,'1000000',100),/authenticity/);
});
test('ETH strategy binds signed quotes to the selected pair and replays its whole-position exit',async()=>{
  const {entry,exit}=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-eth-dry-quotes.json',import.meta.url),'utf8')) as {entry:Quote;exit:Quote};
  const {base,quote}=markets['eth-usdc'],now=()=>Date.parse(exit.receivedAt);
  const provider=liveQuotes(async(_url,options)=>{
    const request=JSON.parse(String(options?.body));
    assert.equal(request.dry,true);
    const receipt=request.originAsset===quote?entry:exit;
    assert.equal(request.amount,receipt.amountIn);
    return new Response(JSON.stringify(receipt.raw));
  },now);
  const store=new DemoStore(':memory:'),demo=new PaperDemo(store,{quotes:()=>provider,now,delay:async()=>{}});
  try {
    const s=demo.create({...config,source:'live',market:'eth-usdc',slippageBps:50});
    assert.equal((await demo.cycle(s.id,manual('BUY'))).portfolio.position,entry.amountOut);
    assert.throws(()=>fill({...store.read(s.id),config:{...s.config,market:'near-usdc'}},'SELL',exit,now()),/inventory/);
    assert.equal((await demo.cycle(s.id,manual('SELL'))).portfolio.position,'0');
    assert.equal(store.export(s.id).session.portfolio.cash,String(BigInt(s.config.initialCash)-BigInt(entry.amountIn)+BigInt(exit.amountOut)));
    await assert.rejects(provider.get(USDC,base,'5000000',50),/Unsupported demo market/);
  } finally { store.close(); }
});
test('catalog markets use native amounts and only pass with signed quotes both ways',async()=>{
  const {market,entry,exit}=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-sol-eth-dry-quotes.json',import.meta.url),'utf8'));
  const now=()=>Date.parse(exit.receivedAt);
  let catalogs=0,failExit=false;
  const fetcher:typeof fetch=async(url,options)=>{
    if(String(url).endsWith('/tokens')){
      catalogs++;
      return new Response(JSON.stringify([market.base,market.quote]));
    }
    const request=JSON.parse(String(options?.body));
    assert.equal(request.dry,true);
    assert.equal(request.depositType,'INTENTS');
    const isEntry=request.originAsset===market.quote.assetId;
    if(!isEntry&&failExit)return new Response(JSON.stringify({message:'No liquidity available'}),{status:400});
    const receipt=isEntry?entry:exit;
    assert.equal(request.amount,receipt.amountIn);
    return new Response(JSON.stringify(receipt.raw));
  };
  const catalog=new IntentMarkets(fetcher,now);
  assert.equal((await catalog.check(market,entry.amountIn,100)).exitId,exit.id);
  await assert.rejects(catalog.check({...market,quote:{...market.quote,decimals:6}},entry.amountIn,100),/metadata changed/);
  failExit=true;
  await assert.rejects(catalog.check(market,entry.amountIn,100),/Sell quote unavailable.*No liquidity/);
  failExit=false;
  assert.equal(catalogs,1);
  const store=new DemoStore(':memory:'),demo=new PaperDemo(store,{quotes:()=>liveQuotes(fetcher,now,market),now,delay:async()=>{}});
  try {
    const s=demo.create({...config,source:'live',market,initialCash:'100000000000000000',tradeCap:entry.amountIn,
      exposureCap:entry.amountIn,dailyTurnoverCap:'100000000000000000'});
    const bought=await demo.cycle(s.id,manual('BUY',entry.amountIn));
    assert.equal(bought.portfolio.position,entry.amountOut);
    assert.equal(marketContext(store.read(s.id),entry,[]).samples[0].inputQuoteUnits,entry.amountIn);
    const sold=await demo.cycle(s.id,manual('SELL',entry.amountIn));
    assert.equal(sold.portfolio.position,'0');
    assert.equal(store.export(s.id).session.portfolio.cash,String(BigInt(s.config.initialCash)-BigInt(entry.amountIn)+BigInt(exit.amountOut)));
  } finally {store.close();}
});
test('the route-unavailable retry stays dry and rejects a receipt for the original route',async()=>{
  const raw=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-dry-quote.json',import.meta.url),'utf8'));
  const requests:any[]=[];
  const provider=liveQuotes(async(_url,options)=>{
    requests.push(JSON.parse(String(options?.body)));
    return requests.length===1
      ? new Response(JSON.stringify({message:'Quoting for this pair is not available'}),{status:400})
      : new Response(JSON.stringify(raw));
  });
  await assert.rejects(provider.get(USDC,WNEAR,'1000000',100),/does not match the dry-only request/);
  assert.deepEqual(requests.map(({dry,depositType,refundType,recipientType})=>({dry,depositType,refundType,recipientType})),[
    {dry:true,depositType:'ORIGIN_CHAIN',refundType:'ORIGIN_CHAIN',recipientType:'DESTINATION_CHAIN'},
    {dry:true,depositType:'INTENTS',refundType:'INTENTS',recipientType:'INTENTS'},
  ]);
});
test('1Click retries a transport failure once and still requires a signed dry-run receipt',async()=>{
  const raw=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-dry-quote.json',import.meta.url),'utf8'));
  let attempts=0;
  const quote=liveQuotes(async(_url,opts)=>{
    assert.equal(JSON.parse(String(opts?.body)).dry,true);
    if(++attempts===1)throw new TypeError('fetch failed');
    return new Response(JSON.stringify(raw),{status:201});
  },()=>Date.parse(raw.timestamp));
  assert.equal((await quote.get(USDC,WNEAR,'1000000',100)).signatureVerified,true);
  assert.equal(attempts,2);
  attempts=0;
  await assert.rejects(liveQuotes(async()=>{++attempts;throw new TypeError('fetch failed');}).get(USDC,WNEAR,'1000000',100),/1Click.*two attempts/);
  assert.equal(attempts,2);
});
test('1Click retries an HTTP 500 quote timeout and surfaces a persistent failure',async()=>{
  const raw=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-dry-quote.json',import.meta.url),'utf8'));
  const unavailable=()=>new Response(JSON.stringify({message:'Failed to receive response within timeout of 25000ms'}),{status:500});
  const requests:string[]=[];
  const provider=liveQuotes(async(_url,options)=>{
    requests.push(String(options?.body));
    return requests.length===1?unavailable():new Response(JSON.stringify(raw),{status:201});
  },()=>Date.parse(raw.timestamp));
  assert.equal((await provider.get(USDC,WNEAR,'1000000',100)).signatureVerified,true);
  assert.deepEqual(requests,[requests[0],requests[0]]);
  let attempts=0;
  const offline=liveQuotes(async()=>{attempts++;return unavailable();});
  await assert.rejects(offline.get(USDC,WNEAR,'1000000',100),/HTTP 500.*timeout/);
  assert.equal(attempts,2);
});
test('paper config rejects remote inference and unlimited economic caps',()=>{assert.throws(()=>validateConfig({...config,endpoint:'https://example.com'}),/loopback/);assert.throws(()=>validateConfig({...config,tradeCap:'999999999999999999999999'}),/million/);});
test('testnet result requires closed portfolio and seals session against future fills',async()=>{
  const {demo,id,store}=create();await demo.attach(id,'alice.testnet',{claim:config.initialCash,session_id:id,pending:null,deposited:config.initialCash});await demo.cycle(id,manual('BUY'));await assert.rejects(demo.result(id),/close/);await demo.cycle(id,manual('SELL'));const result=await demo.result(id);assert.equal(result.new_claim,'19970045');assert.equal(result.expected_claim,'20000000');const before=store.read(id).portfolio;await assert.rejects(demo.cycle(id,manual('BUY')),/sealed/);await assert.rejects(demo.refresh(id),/sealed/);assert.deepEqual(store.read(id).portfolio,before);assert.deepEqual(await demo.result(id),result);assert.throws(()=>demo.start(id),/sealed/);
});
test('testnet-only transaction validation rejects mainnet, foreign receiver and excessive deposits',()=>{
  const c:TestnetConfig={network:'testnet',controllerId:'alice.testnet',reporterId:'alice.testnet',contractId:'demo.testnet',tokenId:TEST_USDC};
  const p={network:'testnet' as const,signerId:'alice.testnet',receiverId:'demo.testnet',description:'withdraw',actions:[{type:'FunctionCall' as const,params:{methodName:'withdraw',args:{amount:'1'},gas:'70000000000000',deposit:'1'}}]};
  validateDemoPlan(p,'alice.testnet',c);assert.throws(()=>validateDemoPlan({...p,network:'mainnet' as any},'alice.testnet',c),/outside/);assert.throws(()=>validateDemoPlan({...p,receiverId:'intents.near'},'alice.testnet',c),/outside/);assert.throws(()=>new TestnetDemo({...c,network:'mainnet' as any}),/Only Circle/);
});
test('model proposal path records observed inference and guards invalid structured output',async()=>{
  const store=new DemoStore(':memory:');let requests=0;
  const fetcher=(async(url:unknown,opts?:RequestInit)=>{
    requests++;
    if(String(url).endsWith('/models'))return new Response(JSON.stringify({data:[{id:'scripted-protocol-fixture'}]}));
    assert.equal(String(url),'http://127.0.0.1:8080/v1/chat/completions');
    const input=JSON.parse(String(opts?.body));assert.equal(input.tools,undefined);assert.equal(input.model,'scripted-protocol-fixture');
    return new Response(JSON.stringify({model:input.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(manual('BUY'))}}]}));
  }) as typeof fetch;
  const demo=new PaperDemo(store,{infer:(s,q,_fetcher,context)=>infer(s,q,fetcher,context),delay:async()=>{}}),s=demo.create(config);
  await demo.cycle(s.id);assert.equal(requests,2);assert.equal(store.read(s.id).portfolio.cash,'15000000');
  const decision=store.history(s.id)[0];assert.equal(decision.model?.id,'scripted-protocol-fixture');assert.equal(decision.evidence,'live-local-model');store.export(s.id);
  const context=JSON.parse((decision.model!.request as any).messages[1].content).marketContext;
  assert.equal(context.sampleCount,1);assert.equal(context.samples[0].quoteId,decision.quote!.id);assert.equal(context.outputChangeBps,null);
  // This exercises protocol wiring with a named fixture, not acceptance of a real model server.
  await assert.rejects(infer(store.read(s.id),await scenarioQuotes().get(USDC,WNEAR,'1000000',100),(async()=>new Response(JSON.stringify({data:[]}))) as typeof fetch),/identify/);
});
test('market context uses comparable recorded quotes and keeps current data when IDs repeat',async()=>{
  const {id,store}=create(),s=store.read(id),now=Date.parse('2026-10-24T21:00:00Z');
  const quote=async(at:number,output:string)=>({...await scenarioQuotes(()=>at).get(USDC,WNEAR,'1000000',100),id:'sample-'+at,amountOut:output,minimumOut:'1'}) satisfies Quote;
  const event=(q:Quote,sessionId=id)=>({kind:'model',sessionId,quote:q}) as Event;
  const first=await quote(now-60000,'200000000000000000000000'),current=await quote(now,'190000000000000000000000');
  const history=[event(await quote(now-16*60000,'1')),event(first),event({...first,source:'live'}),event({...first,tokenIn:WNEAR,tokenOut:USDC}),event({...first,amountIn:'2000000'}),event(await quote(now-20000,'1'),'another-session'),event(await quote(now+1000,'1'))];
  const result=marketContext(s,current,history);assert.equal(result.sampleCount,2);assert.equal(result.spanMs,60000);assert.equal(result.outputChangeBps,-500);
  assert.deepEqual(result.samples.map(x=>x.quoteId),[first.id,current.id]);
  const oldReceipt={...current,receivedAt:new Date(now-1000).toISOString()};
  const duplicate=marketContext(s,current,[event(oldReceipt)]);assert.equal(duplicate.sampleCount,1);assert.equal(duplicate.samples[0].receivedAt,current.receivedAt);
});
test('market context bounds prompt history to twenty recent one-USDC samples',async()=>{
  const {id,store}=create(),s=store.read(id),now=Date.now(),history:Event[]=[];
  for(let i=30;i>0;i--){const q=await scenarioQuotes(()=>now-i*1000).get(USDC,WNEAR,'1000000',100);history.push({kind:'model',sessionId:id,quote:{...q,id:'sample-'+i}} as Event);}
  const current={...await scenarioQuotes(()=>now).get(USDC,WNEAR,'1000000',100),id:'current'};
  const context=marketContext(s,current,history);assert.equal(context.sampleCount,20);assert.equal(context.samples[0].quoteId,'sample-19');assert.equal(context.samples.at(-1)!.quoteId,'current');
  assert.throws(()=>marketContext(s,{...current,amountIn:'2000000'},history),/one-USDC/);
});
test('failed local inference preserves its real input quote without assuming a fill',async()=>{
  const store=new DemoStore(':memory:'),demo=new PaperDemo(store,{infer:async()=>{throw new Error('Local inference exceeded 90 seconds.');},delay:async()=>{}}),s=demo.create(config);
  const result=await demo.cycle(s.id),event=store.history(s.id)[0];
  assert.equal(event.kind,'blocked');assert.equal(event.quote?.amountIn,'1000000');assert.equal(event.model,undefined);
  assert.equal(result.portfolio.cash,config.initialCash);assert.equal(result.portfolio.position,'0');
  const context=marketContext(store.read(s.id),await scenarioQuotes().get(USDC,WNEAR,'1000000',100),store.history(s.id));
  assert.ok(context.samples.some(q=>q.quoteId===event.quote!.id));store.export(s.id);
});
test('inference refuses provider errors and oversized explanations instead of manufacturing a decision',async()=>{
  const {id,store}=create(),s=store.read(id),q=await scenarioQuotes().get(USDC,WNEAR,'1000000',100);
  const provider=(status:number,reason:string)=>(async(url:unknown)=>String(url).endsWith('/models')?new Response(JSON.stringify({data:[{id:'fixture'}]})):new Response(JSON.stringify({model:'fixture',choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'HOLD',quoteUnits:'0',reason})}}]}),{status})) as typeof fetch;
  await assert.rejects(infer(s,q,provider(503,'busy')),/HTTP 503/);
  await assert.rejects(infer(s,q,provider(200,'x'.repeat(241))),/bounded explanation/);
  const accepted=await infer(s,q,provider(200,'Insufficient evidence for a directional trade.'));
  assert.equal(accepted.proposal.action,'HOLD');assert.equal(accepted.proposal.quoteUnits,'0');
});
test('model warm-up refresh records the exact fresh quote used by inference',async()=>{
  const store=new DemoStore(':memory:'),paper=new PaperDemo(store,{infer:async(_s,q)=>{const proposal={action:'HOLD' as const,quoteUnits:'0',reason:'Fixture model hold'};return {id:'fixture-local',request:{},raw:JSON.stringify(proposal),proposal,market:{...q,id:'refreshed-after-warm-up'}};}}),s=paper.create(config);
  await paper.cycle(s.id);const e=store.history(s.id).find(e=>e.kind==='model')!;assert.equal(e.quote!.id,'refreshed-after-warm-up');assert.equal('market' in e.model!,false);assert.equal(store.export(s.id).replay.events,2);store.close();
});
test('a stale replacement quote never records a model action or changes balances',async()=>{
  const store=new DemoStore(':memory:'),paper=new PaperDemo(store,{infer:async(_s,q)=>{const proposal={action:'BUY' as const,quoteUnits:'1000000',reason:'Fixture proposal'};return {id:'fixture-local',request:{},raw:JSON.stringify(proposal),proposal,market:{...q,receivedAt:'2000-01-01T00:00:00.000Z'}};}}),s=paper.create(config);
  await paper.cycle(s.id);assert.equal(store.read(s.id).portfolio.cash,config.initialCash);assert.equal(store.history(s.id).filter(e=>e.kind==='model'||e.kind==='fill').length,0);assert.match(store.history(s.id)[0].reason,/stale/);store.close();
});
test('slow inference retains its actual input receipt while the hypothetical fill requires a new quote',async()=>{
  let now=Date.now();const store=new DemoStore(':memory:');
  const paper=new PaperDemo(store,{now:()=>now,delay:async()=>{},quotes:()=>({get:async(...args)=>{const q=await scenarioQuotes().get(...args);return {...q,observedAt:new Date(now).toISOString(),receivedAt:new Date(now).toISOString()};}}),infer:async(_s,q)=>{now+=45000;const proposal={action:'BUY' as const,quoteUnits:'1000000',reason:'Fixture slow local inference'};return {id:'fixture-local',request:{},raw:JSON.stringify(proposal),proposal,market:q};}}),s=paper.create(config);
  await paper.cycle(s.id);const history=store.history(s.id),input=history.find(e=>e.kind==='model')!,executed=history.find(e=>e.kind==='fill')!;
  assert.ok(executed);assert.equal(Date.parse(executed.quote!.receivedAt)-Date.parse(input.quote!.receivedAt),45000);assert.equal(store.read(s.id).portfolio.cash,'19000000');assert.equal(store.export(s.id).replay.events,3);store.close();
});


test('different agents queue before quotes and ledger leases, preserving one active inference',async()=>{
  const store=new DemoStore(':memory:');let release!:()=>void;const waiting=new Promise<void>(r=>release=r);let calls=0;
  const demo=new PaperDemo(store,{infer:async()=>{calls++;if(calls===1)await waiting;const proposal={action:'HOLD' as const,quoteUnits:'0',reason:'Fixture HOLD'};return {id:'fixture',request:{},raw:JSON.stringify(proposal),proposal};}});
  const a=demo.create(config),b=demo.create({...config,name:'second'});
  const first=demo.cycle(a.id),second=demo.cycle(b.id);await new Promise(r=>setTimeout(r,5));
  assert.equal(calls,1);assert.deepEqual(demo.execution,{activeId:a.id,queued:[b.id]});
  assert.equal((store.db.prepare('SELECT lease FROM sessions WHERE id=?').get(b.id) as any).lease,null);
  release();await Promise.all([first,second]);assert.equal(calls,2);assert.equal(store.export(a.id).replay.events,2);assert.equal(store.export(b.id).replay.events,2);assert.equal(demo.busy,false);demo.close();store.close();
});
test('stopping a worker cancels its queued decision without manufacturing journal activity',async()=>{
  const store=new DemoStore(':memory:');let release!:()=>void;const waiting=new Promise<void>(r=>release=r);let calls=0;
  const demo=new PaperDemo(store,{infer:async()=>{calls++;await waiting;const proposal={action:'HOLD' as const,quoteUnits:'0',reason:'Fixture HOLD'};return {id:'fixture',request:{},raw:JSON.stringify(proposal),proposal};}});
  const a=demo.create(config),b=demo.create({...config,name:'second'});demo.start(a.id);demo.start(b.id);await new Promise(r=>setTimeout(r,10));
  demo.stop(b.id);demo.stop(a.id);release();for(let i=0;i<30&&demo.busy;i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(calls,1);assert.equal(store.read(b.id).sequence,0);assert.equal(demo.busy,false);assert.ok(demo.list().every(s=>s.state==='stopped'));demo.close();store.close();
});
test('model HOLD marks an existing position with a fresh whole-position quote',async()=>{
  let now=Date.now();const store=new DemoStore(':memory:');const demo=new PaperDemo(store,{now:()=>now,quotes:()=>scenarioQuotes(()=>now),delay:async()=>{},infer:async()=>{const proposal={action:'HOLD' as const,quoteUnits:'0',reason:'Fixture hold an existing position'};return {id:'fixture',request:{},raw:JSON.stringify(proposal),proposal};}}),s=demo.create(config);
  await demo.cycle(s.id,manual('BUY'));now+=45000;assert.equal(demo.view(store.read(s.id)).valuationStale,true);await demo.cycle(s.id);
  assert.equal(demo.view(store.read(s.id)).valuationStale,false);assert.equal(store.history(s.id).at(-1)!.kind,'mark');assert.equal(store.history(s.id).filter(e=>e.kind==='fill').length,1);assert.equal(store.read(s.id).portfolio.markAt,new Date(now).toISOString());store.export(s.id);demo.close();store.close();
});


test('stale display retains the last quote through failures and replaces it only after a new valuation',async()=>{
 let now=Date.now(),unavailable=false,extra=0n;
 const store=new DemoStore(':memory:'),demo=new PaperDemo(store,{now:()=>now,delay:async()=>{},quotes:()=>({get:async(a,b,c,d)=>{
  if(unavailable)throw new Error('Fixture quote outage');
  const q=await scenarioQuotes(()=>now).get(a,b,c,d);return a===WNEAR?{...q,amountOut:String(BigInt(q.amountOut)+extra)}:q;
 }})});
 try{
  const s=demo.create(config);await demo.cycle(s.id,manual('BUY'));const quoted=store.read(s.id).portfolio;
  now+=45000;let view=demo.view(store.read(s.id));
  assert.equal(view.valuationStale,true);assert.equal(view.portfolio.equity,null);assert.equal(view.metrics.total,null);
  assert.equal(view.lastValuation?.equity,quoted.equity);assert.equal(view.lastValuation?.at,quoted.markAt);
  unavailable=true;view=await demo.refresh(s.id);
  assert.equal(view.portfolio.equity,null);assert.equal(view.lastValuation?.equity,quoted.equity);assert.equal(view.lastValuation?.at,quoted.markAt);
  const empty=demo.create({...config,name:'Independent session'});assert.equal(empty.lastValuation,null);
  unavailable=false;extra=1000n;now+=1000;view=await demo.refresh(s.id);
  assert.equal(view.valuationStale,false);assert.equal(view.lastValuation,null);assert.equal(view.portfolio.equity,String(BigInt(quoted.equity!)+extra));assert.equal(view.portfolio.markAt,new Date(now).toISOString());
  assert.equal(store.history(s.id).filter(e=>e.kind==='fill').length,1);store.export(s.id);
 }finally{demo.close();store.close();}
});
