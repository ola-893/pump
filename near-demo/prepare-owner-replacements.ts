// Explicit local maintenance for the three user-approved testnet replacements.
// Uses the normal registration and deployment APIs; never edits old declarations.
import {readFileSync,writeFileSync} from 'node:fs';
const file='.local/near-demo/owner-replacement-plan-20261104.json';
const plan=JSON.parse(readFileSync(file,'utf8'));
if(plan.network!=='testnet'||plan.approvedPurpose!=='Recover funds and prepare replacements'||plan.agents.length!==3||plan.agents.some((a:any)=>a.controller!=='rudepuma4060.testnet'))throw new Error('Unexpected replacement approval.');
const base='http://127.0.0.1:5197/api/near-demo';
const status=async()=>{const r=await fetch(base+'/status');if(!r.ok)throw new Error('Local helper unavailable.');return r.json() as Promise<any>;};
const initial=await status();
async function api(path:string,body:unknown){const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':initial.token},body:JSON.stringify(body)});const d=await r.json() as any;if(!r.ok)throw new Error(d.error??'Local preparation failed.');return d;}
await api('/models',{});
for(const copy of plan.agents){
 let {registry}=await status();
 const source=registry.agents.find((a:any)=>a.id===copy.previousAgentId),sourceRun=registry.strategyRuns.find((r:any)=>r.id===copy.previousRunId);
 if(!source||sourceRun?.commitment!==copy.previousCommitment||source.manifest.model.sha256!==copy.modelHash)throw new Error('Original strategy or model changed.');
 const model=registry.models.find((m:any)=>m.id===copy.modelId);if(!model)throw new Error('Original local model unavailable.');
 const matches=registry.agents.filter((a:any)=>a.manifest.controller===copy.controller&&a.manifest.name===copy.name);
 if(matches.length>1)throw new Error('Ambiguous replacement identity.');
 let agent=matches[0];
 if(!agent){const {label:_label,...settings}=copy.settings;agent=(await api('/register-agent',{registration:{...settings,visibility:copy.visibility,name:copy.name,controller:copy.controller,modelId:copy.modelId}})).agent;}
 const m=agent.manifest,s=copy.settings;
 if(m.model.sha256!==copy.modelHash||m.strategy.description!==s.strategy||['tradeCap','exposureCap','dailyTurnoverCap','slippageBps','intervalMs'].some(k=>m.strategy[k]!==s[k]))throw new Error('Replacement settings differ from the approved original.');
 copy.replacementAgentId=agent.id;writeFileSync(file,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
 registry=(await status()).registry;
 const runs=registry.strategyRuns.filter((r:any)=>r.agentId===agent.id);
 let deployment;
 if(runs.length){if(runs.length!==1||runs[0].config.strategy!==s.strategy)throw new Error('Replacement already has unexpected history.');deployment={phase:'active',runId:runs[0].id};}
 else if(registry.pendingStrategyAgents.includes(agent.id))deployment=await api('/strategy-deployment',{agentId:agent.id});
 else deployment=await api('/strategy-save',{agentId:agent.id,expectedVersion:0,settings:s,account:copy.controller});
 copy.deployment=deployment;writeFileSync(file,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({name:copy.name,agentId:agent.id,phase:deployment.phase,contractId:deployment.contractId,unchangedSettings:true}));
}
