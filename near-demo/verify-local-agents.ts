import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { DemoStore } from './store.js';
import { PaperDemo } from './service.js';
import { NearAgents, type AgentRecord } from './agents.js';
import { canonical } from './ledger.js';
import type { Session } from './types.js';
const source=new DatabaseSync(fileURLToPath(new URL('../.local/near-demo/paper.sqlite',import.meta.url)),{readOnly:true});
const records=(source.prepare('SELECT body FROM near_agents ORDER BY rowid').all() as {body:string}[]).map(r=>JSON.parse(r.body) as AgentRecord);
const latest=source.prepare('SELECT body FROM near_comparisons ORDER BY rowid DESC LIMIT 1').get() as {body:string}|undefined;
if(!latest||JSON.parse(latest.body).state!=='complete')throw new Error('Finish the shared comparison before running live-quote verification.');
const store=new DemoStore(':memory:'),paper=new PaperDemo(store),agents=new NearAgents(paper),folder=new URL('../docs/testing/near-agents-20261025/',import.meta.url),summary:unknown[]=[];
await mkdir(folder,{recursive:true});
try{
  for(const name of ['katana','okina','nagakiba']){
    const record=records.find(a=>a.manifest.name===name);if(!record)throw new Error(`Missing ${name}.`);
    const row=source.prepare('SELECT body FROM sessions WHERE id=?').get(record.sessionId) as {body:string};const original=JSON.parse(row.body) as Session;
    const created=paper.create({...original.config,name:`${name} · live quote QA`,source:'live'}),token=store.acquire(created.id);
    try{store.save({...store.read(created.id),agent:{id:record.id,modelId:record.local.modelId,weightsHash:record.manifest.model.sha256}},token);}finally{store.release(created.id,token);}
    store.db.prepare('INSERT INTO near_agents(id,body) VALUES(?,?)').run(record.id,canonical({...record,sessionId:created.id}));
    console.log(`${name}: testing the registered binding with live dry-run quotes in a temporary paper ledger`);
    const view=await paper.cycle(created.id),events=store.history(created.id),decision=events.find(e=>e.kind==='model'&&e.model);
    const bundle=store.export(created.id);await writeFile(new URL(`${name}-live-quote-check.json`,folder),JSON.stringify(bundle,null,2)+'\n');
    if(!decision||decision.model!.id!==record.local.modelId||events.some(e=>e.kind==='blocked'))throw new Error(`${name}: ${events.find(e=>e.kind==='blocked')?.reason??'missing or mismatched local decision'}`);
    const after=source.prepare('SELECT body FROM sessions WHERE id=?').get(record.sessionId) as {body:string};if(after.body!==row.body)throw new Error('The persistent paper session changed during verification.');
    summary.push({name,agentId:record.id,modelId:decision.model!.id,action:decision.model!.proposal.action,liveQuoteSignatureVerified:decision.quote?.signatureVerified,receivedAt:decision.quote?.receivedAt,decisionAt:decision.at,simulatedFills:events.filter(e=>e.kind==='fill').length,paperEquity:view.portfolio.equity,replay:bundle.replay,persistentFundingSessionUnchanged:true});
    console.log(`${name}: ${decision.model!.proposal.action}; signed live input quote; ${events.filter(e=>e.kind==='fill').length} hypothetical fills; replay consistent`);
  }
  await writeFile(new URL('live-quote-check-summary.json',folder),JSON.stringify({scope:'Actual local inference and signed dry-run quotes in temporary ledgers. Persistent funding sessions remain unchanged. No tokens move.',results:summary},null,2)+'\n');
}finally{await agents.close();paper.close();store.close();source.close();}
