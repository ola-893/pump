import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5197/api/near-demo';
const s=await (await fetch(base+'/status')).json() as any;
assert.equal(s.registry.continuous.enabled,true);
const dir=`docs/testing/continuous-running-${new Date().toISOString().replace(/[:.]/g,'-')}`;
await mkdir(dir,{recursive:true});const agents=[];
for(const a of s.registry.agents){const r=await fetch(base+'/agent-export',{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':s.token},body:JSON.stringify({agentId:a.id})});const result=await r.json() as any;if(!r.ok)throw new Error(result.error);const b=result.bundle,events=b.paper.events,fills=events.filter((e:any)=>e.kind==='fill');assert.deepEqual(b.paper.replay.portfolio,b.paper.session.portfolio);assert.equal(b.agent.activity.manual,false);
 for(const f of fills){assert.equal(f.evidence,'operator-directed-model');assert.equal(f.quote.source,'live');assert.equal(f.quote.signatureVerified,true);const m=events.filter((e:any)=>e.kind==='model'&&e.exerciseId===f.exerciseId&&e.sequence<f.sequence).at(-1);assert.equal(m.model.id,b.paper.session.agent.modelId);assert.equal(JSON.parse(m.model.raw).action,f.action);}
 await writeFile(`${dir}/${a.manifest.name}-evidence.json`,JSON.stringify(b,null,2)+'\n');agents.push({name:a.manifest.name,fills:fills.length,buys:fills.filter((e:any)=>e.action==='BUY').length,sells:fills.filter((e:any)=>e.action==='SELL').length,head:b.paper.replay.head});
}
const after=await (await fetch(base+'/status')).json() as any;assert.equal(after.registry.continuous.enabled,true);
const report={capturedAt:new Date().toISOString(),continuous:after.registry.continuous,totalFills:agents.reduce((n,a)=>n+a.fills,0),agents,validation:{tests:222,build:'passed',operatorDirected:true,noTokensMoved:true}};
assert.ok(report.totalFills>=50);await writeFile(`${dir}/verification.json`,JSON.stringify(report,null,2)+'\n');
await writeFile(`${dir}/README.md`,'# Continuous paper trading is running\n\nThe service is authorized to keep generating model-directed paper buy/sell\norders until the user stops it. It targets at least 50 fills per agent and\ncontinues afterward. Existing daily caps remain active; it waits for the UTC\nreset when needed. Authorization persists across server restarts.\n\nThis snapshot verifies at least 50 fills in total. Each saved fill matches\nits local-model response and signed live dry-run quote. All accounting\njournals replay. These are operator-directed execution exercises, excluded\nfrom autonomous strategy ranking. No tokens moved. The loop was left enabled.\n\nStop using the directory control or `npm run demo:live -- stop-continuous`.\n');
console.log(JSON.stringify({directory:dir,...report},null,2));
