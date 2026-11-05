import { mkdir, writeFile } from 'node:fs/promises';
import type { BenchmarkRun } from './benchmark.js';
const origin=process.env.PUMPCOIN_LOCAL_ORIGIN??'http://127.0.0.1:5197';
if(!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(origin))throw new Error('Use a loopback local application origin.');
async function status(){const r=await fetch(origin+'/api/near-demo/status');if(!r.ok)throw new Error('Local app is unavailable.');return r.json() as Promise<any>;}
async function post(path:string,body:unknown,token:string){const r=await fetch(origin+'/api/near-demo'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':token},body:JSON.stringify(body)});const d=await r.json() as any;if(!r.ok)throw new Error(d.error);return d;}
const first=await status(),names=['katana','okina','nagakiba'];
const agents=names.map(name=>{const a=first.registry.agents.find((a:any)=>a.manifest.name===name);if(!a)throw new Error(`${name} is not registered.`);return a;});
let current=first.registry.comparisons.find((r:BenchmarkRun)=>r.state==='running') as BenchmarkRun|undefined;
if(!current)current=(await post('/compare',{agentIds:agents.map(a=>a.id)},first.token)).comparison;
const id=current!.id;console.log(`Comparison ${id}: same 24 daily decisions for ${names.join(', ')}; no token transfers.`);
let previous='';
for(;;){const s=await status(),run=s.registry.comparisons.find((r:BenchmarkRun)=>r.id===id) as BenchmarkRun|undefined;if(!run)throw new Error('Comparison missing from local store.');
  const message=run.results.map(r=>`${s.registry.agents.find((a:any)=>a.id===r.agentId)?.manifest.name}: ${r.steps.length}/24 ${r.state}${r.steps.at(-1)?.status==='error'?' ERROR '+r.steps.at(-1)!.reason:''}`).join(' | ')+` | runtime ${s.registry.runtime.phase}`;
  if(message!==previous){console.log(message);previous=message;}
  if(run.state!=='running'){
    const folder=new URL('../docs/testing/near-agents-20261025/',import.meta.url);await mkdir(folder,{recursive:true});
    for(const agent of agents){const result=await post('/agent-export',{agentId:agent.id},s.token);await writeFile(new URL(agent.manifest.name+'-evidence.json',folder),JSON.stringify(result.bundle,null,2)+'\n');}
    await writeFile(new URL('comparison-summary.json',folder),JSON.stringify(run,null,2)+'\n');
    console.log(`Comparison ${run.state}. Replay-checked evidence saved under docs/testing/near-agents-20261025.`);
    if(run.state!=='complete'||run.results.some(r=>r.steps.some(s=>s.status==='error')))process.exitCode=1;break;
  }
  await new Promise(r=>setTimeout(r,5000));
}
