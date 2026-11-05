import { DemoStore } from './store.js';
import { PaperDemo } from './service.js';
import { NearAgents, SHARED_STRATEGY } from './agents.js';
import { readFileSync } from 'node:fs';
const path=new URL('../.local/near-demo/paper.sqlite',import.meta.url).pathname;
const config=JSON.parse(readFileSync(new URL('../deployments/near-demo-testnet.json',import.meta.url),'utf8'));
const paper=new PaperDemo(new DemoStore(decodeURIComponent(path))),agents=new NearAgents(paper);
try{
  const models=await agents.inventory.scan();
  for(const [name,pattern] of [['katana',/muse-glimmer/i],['okina',/qwen/i],['nagakiba',/gemma.*26/i]] as const){
    const existing=agents.records().find(a=>a.manifest.name===name);if(existing){console.log(`${name}: already registered (${existing.id})`);continue;}
    const candidates=models.filter(m=>pattern.test(m.name));if(candidates.length!==1)throw new Error(`Expected exactly one detected model for ${name}; found ${candidates.length}.`);
    console.log(`${name}: measuring ${candidates[0].filename} in place`);
    const registered=await agents.register({visibility:'public',name,controller:config.controllerId,modelId:candidates[0].id,strategy:SHARED_STRATEGY,initialCash:'100000000',tradeCap:'20000000',exposureCap:'80000000',dailyTurnoverCap:'100000000',slippageBps:50,intervalMs:60000});
    console.log(`${name}: registered ${registered.id}; SHA-256 ${registered.manifest.model.sha256}`);
  }
}finally{await agents.close();paper.close();paper.store.close();}
