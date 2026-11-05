import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DemoStore} from '../near-demo/store.js';
import {PaperDemo} from '../near-demo/service.js';
import {makeEvent,fill,digest} from '../near-demo/ledger.js';
import {verifyStrategyDecisions} from '../near-demo/directory/strategy-evidence.js';
import type {Config,Quote} from '../near-demo/types.js';

// Retained signed dry-run receipts, not a network-dependent or fabricated fill.
const evidence=JSON.parse(readFileSync(new URL('../docs/testing/continuous-50-2026-10-25T16-08-49-491Z/katana-evidence.json',import.meta.url),'utf8'));
const fills=evidence.paper.events.filter((e:any)=>e.kind==='fill');
const buy=structuredClone(fills[0].quote) as Quote,sell=structuredClone(fills[1].quote) as Quote;
function fixture(overrides:Partial<Config>={}){
 let now=Date.parse(buy.receivedAt),calls=0;
 let exit:()=>Promise<Quote>=async()=>structuredClone(sell);
 const store=new DemoStore(':memory:'),paper=new PaperDemo(store,{now:()=>now,quotes:()=>({get:async()=>{calls++;return exit();}})});
 const config:Config={name:'Operator exit fixture',initialCash:'100000000',tradeCap:'10000000',exposureCap:'30000000',dailyTurnoverCap:'60000000',slippageBps:50,executionDelayMs:1500,maxQuoteAgeMs:30000,source:'live',endpoint:'http://127.0.0.1:8093/v1',strategy:'Keep this committed strategy unchanged during the owner exit.',intervalMs:60000,...overrides};
 const view=paper.create(config),lease=store.acquire(view.id);let s=store.read(view.id);
 s={...s,agent:{id:'fixture-agent',modelId:'fixture',weightsHash:'fixture',strategyRunId:'fixture-run'}};
 const after=fill(s,'BUY',buy,now),day=new Date(now).toISOString().slice(0,10);
 const entry=makeEvent(s,{kind:'fill',action:'BUY',evidence:'live-local-model',reason:'Retained BUY fixture',quote:buy,after,at:new Date(now).toISOString()});
 store.save({...s,turnover:{day,used:buy.amountIn}},lease,entry);store.release(s.id,lease);
 now=Date.parse(sell.receivedAt);
 return {store,paper,id:s.id,entry,calls:()=>calls,setExit:(fn:()=>Promise<Quote>)=>{exit=fn;},advance:(ms:number)=>{now+=ms;}};
}
test('explicit whole-position owner exit preserves strategy, enforces quote receipts and cannot replay against a later lot',async()=>{
 const f=fixture();try{
 const before=f.store.read(f.id),commitment=digest(before.config);
 const result=await f.paper.operatorExit(f.id,before.portfolio.position,f.entry.hash);
 assert.equal(result.error,null);assert.equal(result.portfolio.position,'0');assert.equal(result.portfolio.cost,'0');
 assert.equal(result.portfolio.cash,String(BigInt(before.portfolio.cash)+BigInt(sell.amountOut)));
 assert.equal(digest(f.store.read(f.id).config),commitment);assert.equal(f.calls(),1);
 const events=f.store.history(f.id),exit=events.find(e=>e.evidence==='operator-exit')!;
 assert.equal(exit.kind,'fill');assert.equal(exit.action,'SELL');assert.equal(exit.model,undefined);assert.equal(exit.operatorExit!.lastFillHash,f.entry.hash);
 assert.equal(f.store.export(f.id).replay.events,3);
 assert.equal(verifyStrategyDecisions({config:before.config},[exit],'fixture'),true);
 assert.throws(()=>verifyStrategyDecisions({config:before.config},[{...exit,action:'BUY'}],'fixture'),/Invalid owner/);
 await assert.rejects(f.paper.operatorExit(f.id,before.portfolio.position,f.entry.hash),/position changed/);
 assert.equal(f.store.history(f.id).filter(e=>e.evidence==='operator-exit'&&e.kind==='fill').length,1);
 }finally{f.paper.close();f.store.close();}
});
test('wrong position or last fill, concurrent calls, and a running worker cannot consume an operator exit twice',async()=>{
 const f=fixture();try{
 const position=f.store.read(f.id).portfolio.position;
 await assert.rejects(f.paper.operatorExit(f.id,position,'wrong-hash'),/position changed/);
 await assert.rejects(f.paper.operatorExit(f.id,'1',f.entry.hash),/position changed/);assert.equal(f.calls(),0);
 f.paper.start(f.id);await assert.rejects(f.paper.operatorExit(f.id,position,f.entry.hash),/Stop the worker/);f.paper.stop(f.id);
 let release!:()=>void;f.setExit(()=>new Promise(resolve=>{release=()=>resolve(structuredClone(sell));}));
 const first=f.paper.operatorExit(f.id,position,f.entry.hash);
 await assert.rejects(f.paper.operatorExit(f.id,position,f.entry.hash),/owns/);release();await first;
 assert.equal(f.store.history(f.id).filter(e=>e.kind==='fill').length,2);
 }finally{f.paper.close();f.store.close();}
});
test('quote outages, stale or mismatched quotes, per-trade and daily caps fail without changing balances',async()=>{
 for(const mode of ['outage','stale','tampered','partial','trade-cap','turnover-cap']){
 const f=fixture(mode==='turnover-cap'?{dailyTurnoverCap:'2000000',tradeCap:'2000000'}:{});try{
 const before=f.store.read(f.id);
 if(mode==='outage')f.setExit(async()=>{throw new Error('Quote provider unavailable.');});
 if(mode==='stale')f.advance(31000);
 if(mode==='tampered')f.setExit(async()=>({...sell,amountOut:'1'}));
 if(mode==='partial')f.setExit(async()=>({...sell,amountIn:'1'}));
 if(mode==='trade-cap')f.setExit(async()=>({...sell,amountOut:'10000001'}));
 const result=await f.paper.operatorExit(f.id,before.portfolio.position,f.entry.hash);
 assert.ok(result.error,mode);assert.deepEqual(f.store.read(f.id).portfolio,before.portfolio,mode);
 assert.equal(f.store.history(f.id).filter(e=>e.kind==='fill').length,1);assert.equal(f.store.export(f.id).replay.events,2);
 }finally{f.paper.close();f.store.close();}
 }
});
