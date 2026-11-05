/** Observe a milestone without disabling the independently running trader. */
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5197/api/near-demo',target=Number(process.argv[2]??50);
if(!Number.isInteger(target)||target<1)throw new Error('Invalid observation target.');
let previous='',errors=0;
for(;;){
 try{
  const r=await fetch(base+'/status',{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`Status ${r.status}`);const s=await r.json() as any;
  const progress={at:new Date().toISOString(),enabled:s.registry.continuous?.enabled,phase:s.registry.continuous?.phase,active:s.registry.continuous?.activeAgentId,error:s.registry.continuous?.error,agents:s.registry.agents.map((a:any)=>({name:a.manifest.name,buys:a.activity.buys,sells:a.activity.sells,fills:a.activity.fills,error:a.session.error}))};
  const key=JSON.stringify({...progress,at:''});if(key!==previous){console.log(JSON.stringify(progress));previous=key;await writeFile('.local/near-demo/continuous-progress.json',JSON.stringify(progress,null,2)+'\n');}errors=0;
  if(s.registry.agents.length&&s.registry.agents.every((a:any)=>a.activity.fills>=target)){
   const dir=`docs/testing/continuous-${target}-${new Date().toISOString().replace(/[:.]/g,'-')}`;await mkdir(dir,{recursive:true});const results=[];
   for(const a of s.registry.agents){const response=await fetch(base+'/agent-export',{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':s.token},body:JSON.stringify({agentId:a.id})});const result=await response.json() as any;if(!response.ok)throw new Error(result.error);const b=result.bundle,events=b.paper.events,fills=events.filter((e:any)=>e.kind==='fill');assert.ok(fills.length>=target);assert.equal(b.agent.activity.manual,false);assert.deepEqual(b.paper.replay.portfolio,b.paper.session.portfolio);
    for(const f of fills){assert.equal(f.evidence,'operator-directed-model');assert.equal(f.quote.source,'live');assert.equal(f.quote.signatureVerified,true);const decision=events.filter((e:any)=>e.kind==='model'&&e.exerciseId===f.exerciseId&&e.sequence<f.sequence).at(-1);assert.equal(decision.model.id,b.paper.session.agent.modelId);assert.equal(JSON.parse(decision.model.raw).action,f.action);const input=JSON.parse(decision.model.request.messages[1].content);assert.equal(input.marketContext.executionExercise.id,f.exerciseId);assert.equal(input.marketContext.executionExercise.phase,f.action);}
    await writeFile(`${dir}/${a.manifest.name}-evidence.json`,JSON.stringify(b,null,2)+'\n');results.push({name:a.manifest.name,fills:fills.length,buys:fills.filter((e:any)=>e.action==='BUY').length,sells:fills.filter((e:any)=>e.action==='SELL').length,position:b.paper.session.portfolio.position,realized:b.paper.session.portfolio.realized,head:b.paper.replay.head});
   }
   const report={capturedAt:new Date().toISOString(),target,continuousEnabled:s.registry.continuous?.enabled,scope:'Operator-directed local-model paper execution, excluded from autonomous strategy ranking. No token transfers.',agents:results};await writeFile(`${dir}/verification.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({milestoneReached:true,directory:dir,...report}));break;
  }
  if(!s.registry.continuous?.enabled){console.log(JSON.stringify({stopped:true,reason:'Continuous authorization disabled; observer exits.'}));break;}
 }catch(e){console.log(JSON.stringify({observationError:e instanceof Error?e.message:'Observation failed'}));if(++errors>=20)throw e;}
 await new Promise(r=>setTimeout(r,15000));
}
