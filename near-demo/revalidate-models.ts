import { writeFile } from 'node:fs/promises';
import { digest } from './ledger.js';
import { fileURLToPath } from 'node:url';
import { DemoStore } from './store.js';
import { PaperDemo } from './service.js';
import { NearAgents } from './agents.js';
const names=process.argv.slice(2);
if(!names.length)throw new Error('Supply registered agent names to revalidate.');
const store=new DemoStore(fileURLToPath(new URL('../.local/near-demo/paper.sqlite',import.meta.url))),paper=new PaperDemo(store),agents=new NearAgents(paper);
const checkpoint=()=>({sessions:digest(JSON.stringify(store.db.prepare('SELECT id,revision,body FROM sessions ORDER BY id').all())),events:digest(JSON.stringify(store.db.prepare('SELECT session,sequence,body FROM events ORDER BY session,sequence').all())),strategies:digest(JSON.stringify(store.db.prepare('SELECT id,body FROM near_strategy_runs ORDER BY id').all()))});
const before=checkpoint(),results:unknown[]=[];
try{
  const records=names.map(name=>{const a=agents.records().find(a=>a.manifest.name===name);if(!a)throw new Error(`Unknown registered agent: ${name}`);return a;});
  for(const a of records){
    console.log(`${a.manifest.name}: checking the original model file against its registered SHA-256…`);
    const checked=await agents.revalidateModel(a.id);
    const result={name:checked.manifest.name,agentId:checked.id,sha256:checked.manifest.model.sha256,metadataRefreshed:checked.local.stamp!==a.local.stamp,revalidatedAt:checked.local.revalidatedAt??null,previousStamp:a.local.stamp,currentStamp:checked.local.stamp};results.push(result);console.log(JSON.stringify(result));
  }
  const after=checkpoint();if(digest(before)!==digest(after))throw new Error('A portfolio, strategy or journal changed during verification; inspect concurrent workers.');
  const report={checkedAt:new Date().toISOString(),scope:'Model content and local file metadata only; no inference, orders or token movements.',results,checkpoints:{before,after},portfoliosStrategiesAndJournalsUnchanged:true};
  const reportPath=new URL('../.local/near-demo/model-revalidation-'+Date.now()+'.json',import.meta.url);
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log('Verification report: '+fileURLToPath(reportPath));
}finally{paper.close();await agents.close();store.close();}
