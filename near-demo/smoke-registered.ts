import { DemoStore } from './store.js';
import { LocalRuntime } from './runtime.js';
import { historicalDecision } from './benchmark.js';
import { writeFile } from 'node:fs/promises';
const store=new DemoStore(decodeURIComponent(new URL('../.local/near-demo/paper.sqlite',import.meta.url).pathname)),runtime=new LocalRuntime();
const agent=JSON.parse((store.db.prepare('SELECT body FROM near_agents ORDER BY rowid LIMIT 1').get() as {body:string}).body);
const dataset=JSON.parse((store.db.prepare('SELECT body FROM near_market ORDER BY rowid DESC LIMIT 1').get() as {body:string}).body);
try{await runtime.use({id:agent.local.modelId,path:agent.local.path,stamp:agent.local.stamp},async()=>{
  const fetcher=(async(url,opts)=>{const r=await fetch(url,opts);await writeFile(new URL('../.local/near-demo/model-response-check.json',import.meta.url),await r.clone().text());return r;}) as typeof fetch;
  const d=await historicalDecision(runtime.endpoint,agent.local.modelId,agent.manifest.strategy.description,{cash:'100000000',position:'0',cost:'0',realized:'0'},dataset,143,fetcher);console.log(d.proposal);
});}finally{await runtime.close();store.close();}
