import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, stat, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ModelInventory, stamp } from '../near-demo/inventory.js';
import { NearAgents, type AgentRecord } from '../near-demo/agents.js';
import { DemoStore } from '../near-demo/store.js';
import { PaperDemo } from '../near-demo/service.js';
import { canonical, digest } from '../near-demo/ledger.js';
const bytes=Buffer.concat([Buffer.from('GGUF'),Buffer.alloc(100,7)]),sha=createHash('sha256').update(bytes).digest('hex');
const remounted=(s:string)=>['old-device',...s.split(':').slice(1)].join(':');
const config={name:'fixture',initialCash:'100000000',tradeCap:'10000000',exposureCap:'30000000',dailyTurnoverCap:'60000000',slippageBps:50,executionDelayMs:1500,maxQuoteAgeMs:30000,source:'replay' as const,endpoint:'http://127.0.0.1:8093/v1',strategy:'Fixture mandate: preserve capital and HOLD without a signal.',intervalMs:60000};
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'pump-revalidate-')),path=join(dir,'fixture.gguf');await writeFile(path,bytes);
 const store=new DemoStore(':memory:'),paper=new PaperDemo(store,{delay:async()=>{}}),agents=new NearAgents(paper),s=paper.create(config);
 await paper.cycle(s.id,{action:'BUY',quoteUnits:'1000000',reason:'Disposable test fixture; never actual trading evidence.'});
 const manifest:AgentRecord['manifest']={version:'PUMPCOIN-NEAR-AGENT-v1',name:'fixture',controller:'fixture.testnet',network:'NEAR testnet',model:{id:'fixture',filename:'fixture.gguf',bytes:bytes.length,sha256:sha,quantization:'fixture'},inference:{policy:'self-hosted-only',runtime:'llama.cpp',context:4096,attestation:'none'},strategy:{description:config.strategy,pair:'wNEAR / USDC',tradeCap:config.tradeCap,exposureCap:config.exposureCap,dailyTurnoverCap:config.dailyTurnoverCap,slippageBps:50,intervalMs:60000},mode:'paper trading; optional Circle testnet clearing',evidence:'locally measured weights; unsigned local declaration'};
 const a:AgentRecord={id:randomUUID(),createdAt:new Date().toISOString(),manifest,commitment:digest(manifest),sessionId:s.id,local:{modelId:'fixture',path,stamp:remounted(stamp(await stat(path)))}};
 store.db.prepare('INSERT INTO near_agents(id,body) VALUES(?,?)').run(a.id,canonical(a));
 return {dir,path,store,paper,agents,a,async close(){paper.close();await agents.close();store.close();await rm(dir,{recursive:true,force:true});}};
}
test('filesystem device changes require matching content before a replacement stamp is accepted',async()=>{
 const f=await fixture();try{
  const inventory=new ModelInventory(),current=stamp(await stat(f.path));
  await assert.rejects(inventory.unchanged(f.path,f.a.local.stamp),/changed/);
  assert.equal(await inventory.revalidate(f.path,f.a.local.stamp,sha),current);
  await assert.rejects(inventory.revalidate(f.path,f.a.local.stamp,'0'.repeat(64)),/checksum changed/);
  await assert.rejects(inventory.revalidate(f.path,current,'bad'),/checksum is invalid/);
 }finally{await f.close();}
});
test('verified metadata repair preserves registration, portfolios, strategy commitments and nonempty journals',async()=>{
 const f=await fixture();try{
  const settings={label:'Fixture strategy',strategy:config.strategy,initialCash:config.initialCash,tradeCap:config.tradeCap,exposureCap:config.exposureCap,dailyTurnoverCap:config.dailyTurnoverCap,slippageBps:50,intervalMs:60000};
  const run=f.agents.strategies.save(f.a.id,0,settings),before=f.store.export(f.a.sessionId),strategy=f.agents.strategies.export(run.id);
  assert.ok(before.events.length>0);
  const checked=await f.agents.revalidateModel(f.a.id);
  assert.equal(checked.id,f.a.id);assert.equal(checked.commitment,f.a.commitment);assert.deepEqual(checked.manifest,f.a.manifest);
  assert.equal(checked.local.path,f.a.local.path);assert.equal(checked.local.modelId,f.a.local.modelId);assert.equal(checked.local.stamp,stamp(await stat(f.path)));assert.ok(checked.local.revalidatedAt);
  assert.equal(f.agents.publicRecord(checked).modelRevalidatedAt,checked.local.revalidatedAt);
  assert.deepEqual(f.store.export(f.a.sessionId),before);assert.deepEqual(f.agents.strategies.export(run.id),strategy);
  assert.deepEqual(await f.agents.revalidateModel(f.a.id),checked);
 }finally{await f.close();}
});
test('a same-size weights edit stays blocked and never refreshes the registered metadata',async()=>{
 const f=await fixture();try{
  const before=f.agents.read(f.a.id),journal=f.store.export(f.a.sessionId),edited=Buffer.from(bytes);edited[20]^=1;await writeFile(f.path,edited);
  const t=new Date(Date.now()+5000);await utimes(f.path,t,t);
  await assert.rejects(f.agents.revalidateModel(f.a.id),/checksum changed/);
  assert.deepEqual(f.agents.read(f.a.id),before);assert.deepEqual(f.store.export(f.a.sessionId),journal);
 }finally{await f.close();}
});
test('a concurrent registration edit is not overwritten by a completed verification',async()=>{
 const f=await fixture();try{
  const verify=f.agents.inventory.revalidate.bind(f.agents.inventory);
  f.agents.inventory.revalidate=async(...args)=>{const result=await verify(...args);f.store.db.prepare('UPDATE near_agents SET body=? WHERE id=?').run(canonical({...f.a,local:{...f.a.local,path:'/different.gguf'}}),f.a.id);return result;};
  await assert.rejects(f.agents.revalidateModel(f.a.id),/binding changed/);assert.equal(f.agents.read(f.a.id).local.path,'/different.gguf');
 }finally{await f.close();}
});
