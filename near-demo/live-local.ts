/** Controls the actual persisted agent sessions served by the local demo. */
import { mkdir, writeFile } from 'node:fs/promises';
const base='http://127.0.0.1:5197/api/near-demo';
const action=process.argv[2]??'status';
if(!['start','stop','status','export','exercise','continuous','stop-continuous'].includes(action))throw new Error('Use start, stop, status, export or exercise.');
const get=async()=>{const r=await fetch(base+'/status');if(!r.ok)throw new Error(`Status HTTP ${r.status}`);return await r.json() as any;};
let state=await get();
const post=async(path:string,body:unknown)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':state.token},body:JSON.stringify(body)});const result=await r.json() as any;if(!r.ok)throw new Error(result.error);return result;};
if(action==='continuous')await post('/start-continuous',{agentIds:state.registry.agents.map((a:any)=>a.id)});
if(action==='stop-continuous')await post('/stop-continuous',{});
if(action==='exercise')await post('/execution-exercise',{agentIds:state.registry.agents.map((a:any)=>a.id)});
if(action==='start')await post('/start-live',{agentIds:state.registry.agents.map((a:any)=>a.id)});
if(action==='stop')await post('/stop-live',{});
if(action==='export'){
  const dir='docs/testing/live-agents-20261025';await mkdir(dir,{recursive:true});
  for(const a of state.registry.agents){const {bundle}=await post('/agent-export',{agentId:a.id});await writeFile(`${dir}/${a.manifest.name}-evidence.json`,JSON.stringify(bundle,null,2)+'\n');}
}
state=await get();
console.log(JSON.stringify({continuous:state.registry.continuous,execution:state.registry.execution,runtime:state.registry.runtime,agents:state.registry.agents.map((a:any)=>({name:a.manifest.name,sessionId:a.sessionId,state:a.session.state,activity:a.activity,exercise:a.exercise,equity:a.session.portfolio.equity,returnBps:a.session.metrics.returnBps,valuationStale:a.session.valuationStale,error:a.session.error}))},null,2));
