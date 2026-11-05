import test from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousTrading } from '../near-demo/continuous.js';
import { PaperDemo } from '../near-demo/service.js';
import { DemoStore } from '../near-demo/store.js';
import type { NearAgents } from '../near-demo/agents.js';
import type { Proposal,Config } from '../near-demo/types.js';
const config:Config={name:'fixture',initialCash:'100000000',tradeCap:'2000000',exposureCap:'8000000',dailyTurnoverCap:'100000000',slippageBps:50,executionDelayMs:1000,maxQuoteAgeMs:30000,source:'replay',endpoint:'http://127.0.0.1:8093/v1',strategy:'Fixture test strategy',intervalMs:60000};
function fixture(cap='100000000'){
 const store=new DemoStore(':memory:'),paper=new PaperDemo(store,{delay:async()=>{},infer:async s=>{const proposal:Proposal={action:s.portfolio.position==='0'?'BUY':'SELL',quoteUnits:'2000000',reason:'Named fixture; operator-directed test.'};return {id:'fixture',request:{},raw:JSON.stringify(proposal),proposal};}});
 const records=[0,1,2].map(i=>({id:`agent${i}`,sessionId:paper.create({...config,name:`agent${i}`,dailyTurnoverCap:cap}).id}));
 const agents={paper,read:(id:string)=>{const a=records.find(a=>a.id===id);if(!a)throw new Error('Missing agent');return a;},runs:()=>[]} as unknown as NearAgents;
 const loop=new ContinuousTrading(agents,{autoResume:false,delayMs:100000000});return {store,paper,records,agents,loop};
}
test('continuous trading makes model-generated alternating fills, rotates fairly, and stays enabled beyond its milestone',async()=>{
 const f=fixture();try{f.loop.start(f.records.map(a=>a.id));for(let i=0;i<18;i++)await f.loop.tick();assert.equal(f.loop.status()!.enabled,true);assert.equal(f.loop.status()!.cursor,0);for(const a of f.records){assert.equal(f.store.history(a.sessionId).filter(e=>e.kind==='fill').length,6);assert.equal(f.store.read(a.sessionId).portfolio.position,'0');f.store.export(a.sessionId);}assert.equal(f.loop.status()!.targetPerAgent,50);}finally{f.loop.stop();f.loop.close();f.paper.close();f.store.close();}
});
test('continuous authorization persists across restart and stop is not undone by an in-flight inference',async()=>{
 const f=fixture();let resumed:ContinuousTrading|undefined;try{
  f.loop.start(f.records.map(a=>a.id));f.loop.close();resumed=new ContinuousTrading(f.agents,{autoResume:true,delayMs:100000000});
  let release!:()=>void;const waiting=new Promise<void>(r=>release=r);f.paper.setInferenceProvider(async()=>{await waiting;const proposal:Proposal={action:'BUY',quoteUnits:'2000000',reason:'Fixture authorized order'};return {id:'fixture',request:{},raw:JSON.stringify(proposal),proposal};});
  const cycle=resumed.tick();await new Promise(r=>setTimeout(r,10));resumed.stop();release();await cycle;
  assert.equal(resumed.status()!.enabled,false);assert.equal(resumed.status()!.phase,'stopped');const count=f.store.history(f.records[0].sessionId).length;await resumed.tick();assert.equal(f.store.history(f.records[0].sessionId).length,count);f.store.export(f.records[0].sessionId);
 }finally{resumed?.close();f.loop.close();f.paper.close();f.store.close();}
});
test('continuous exercise waits at daily turnover cap without inventing activity',async()=>{
 const f=fixture('4000000');try{f.loop.start(f.records.map(a=>a.id));await f.loop.tick();assert.equal(f.loop.status()!.phase,'waiting for UTC turnover reset');assert.ok(f.records.every(a=>f.store.history(a.sessionId).length===0));assert.equal(f.loop.status()!.enabled,true);}finally{f.loop.stop();f.loop.close();f.paper.close();f.store.close();}
});
