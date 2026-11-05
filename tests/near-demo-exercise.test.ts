import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoStore } from '../near-demo/store.js';
import { PaperDemo } from '../near-demo/service.js';
import { exerciseGuidance } from '../near-demo/exercise.js';
import { canonical } from '../near-demo/ledger.js';
import type { Config, Proposal } from '../near-demo/types.js';
const config:Config={name:'exercise fixture',initialCash:'100000000',tradeCap:'20000000',exposureCap:'80000000',dailyTurnoverCap:'100000000',slippageBps:50,executionDelayMs:1000,maxQuoteAgeMs:30000,source:'replay',endpoint:'http://127.0.0.1:8080/v1',strategy:'Protect capital; hold if there is no market edge.',intervalMs:60000};
function fixture(proposals:Proposal[]){const store=new DemoStore(':memory:');let i=0;const paper=new PaperDemo(store,{delay:async()=>{},infer:async()=>{const proposal=proposals[i++];return {id:'named-test-fixture',request:{},raw:JSON.stringify(proposal),proposal};}}),s=paper.create(config);return {store,paper,id:s.id};}
const buy=(n='2000000'):Proposal=>({action:'BUY',quoteUnits:n,reason:'Operator-directed paper execution exercise.'});
const sell:Proposal={action:'SELL',quoteUnits:'20000000',reason:'Operator-directed paper inventory exit.'};
test('recorded operator exercise progresses from model BUY to full SELL with replayable economic loss',async()=>{
  const {paper,store,id}=fixture([buy(),sell]);try{
    const original=canonical(store.read(id).config);await paper.requestExercise(id);
    assert.equal(exerciseGuidance(store.read(id),store.history(id))!.phase,'BUY');
    await paper.cycle(id);assert.equal(exerciseGuidance(store.read(id),store.history(id))!.phase,'SELL');
    await paper.cycle(id);const s=store.read(id),events=store.history(id);
    assert.equal(exerciseGuidance(s,events)!.phase,'COMPLETE');assert.equal(s.portfolio.position,'0');assert.ok(BigInt(s.portfolio.realized)<0n);assert.equal(canonical(s.config),original);
    assert.deepEqual(events.filter(e=>e.kind==='fill').map(e=>e.action),['BUY','SELL']);assert.ok(events.filter(e=>e.kind==='fill'||e.kind==='model').every(e=>e.evidence==='operator-directed-model'&&e.exerciseId===s.exercise!.id));assert.ok(!events.some(e=>e.evidence==='manual-scenario'));store.export(id);
    const changed={...s,exercise:{...s.exercise!,buyQuoteUnits:'3000000'}} as any;assert.throws(()=>{const row=store.db.prepare('SELECT body FROM sessions WHERE id=?').get(id) as any;store.db.prepare('UPDATE sessions SET body=? WHERE id=?').run(JSON.stringify(changed),id);try{store.export(id);}finally{store.db.prepare('UPDATE sessions SET body=? WHERE id=?').run(row.body,id);}},/mandate checkpoint/);
  }finally{paper.close();store.close();}
});
test('nudging never overrides hard exercise size or phase limits',async()=>{
  const {paper,store,id}=fixture([buy('3000000'),buy(),buy(),sell]);try{
    await paper.requestExercise(id);await paper.cycle(id);assert.equal(store.read(id).portfolio.position,'0');assert.equal(store.history(id).filter(e=>e.kind==='fill').length,0);
    await paper.cycle(id);const position=store.read(id).portfolio.position;await paper.cycle(id);assert.equal(store.read(id).portfolio.position,position);assert.equal(store.history(id).filter(e=>e.kind==='fill').length,1);
    await paper.cycle(id);assert.equal(store.read(id).portfolio.position,'0');assert.equal(store.history(id).filter(e=>e.kind==='blocked').length,2);store.export(id);
  }finally{paper.close();store.close();}
});
test('operator exercise cannot relabel an existing open position or testnet claim',async()=>{
  const {paper,store,id}=fixture([buy()]);try{await paper.cycle(id);await assert.rejects(paper.requestExercise(id),/no position/);const fresh=paper.create({...config,name:'funded fixture'});await paper.attach(fresh.id,'owner.testnet',{claim:config.initialCash,session_id:fresh.id,pending:null,deposited:config.initialCash});await assert.rejects(paper.requestExercise(fresh.id),/unfunded/);}finally{paper.close();store.close();}
});
test('additional recorded exercises preserve old mandates and replay all round trips',async()=>{
  const {paper,store,id}=fixture([buy(),sell,buy(),sell,buy(),sell]);try{
    const ids=[];
    for(let i=0;i<3;i++){
      await paper.requestExercise(id);ids.push(store.read(id).exercise!.id);
      await assert.rejects(paper.requestExercise(id),/Complete the active/);
      await paper.cycle(id);await paper.cycle(id);assert.equal(exerciseGuidance(store.read(id),store.history(id))!.phase,'COMPLETE');store.export(id);
    }
    assert.equal(new Set(ids).size,3);assert.equal(store.history(id).filter(e=>e.kind==='mandate').length,3);assert.equal(store.history(id).filter(e=>e.kind==='fill').length,6);assert.equal(store.read(id).portfolio.position,'0');
  }finally{paper.close();store.close();}
});
