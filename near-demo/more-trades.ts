/** Run additional disclosed model-generated round trips on persisted sessions. */
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5197/api/near-demo';
const rounds=Number(process.argv[2]??3);
if(!Number.isInteger(rounds)||rounds<1||rounds>5)throw new Error('Choose one to five additional round trips per agent.');
const get=async()=>{const r=await fetch(base+'/status');if(!r.ok)throw new Error('Local server unavailable.');return await r.json() as any;};
let state=await get();
const post=async(path:string,body:unknown)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':state.token},body:JSON.stringify(body)});const d=await r.json() as any;if(!r.ok)throw new Error(d.error);return d;};
if(state.registry.execution.activeId||state.registry.agents.some((a:any)=>a.session.state==='running'))throw new Error('Stop workers and wait for the current decision first.');
const baseline=state.registry.agents.map((a:any)=>({id:a.id,name:a.manifest.name,fills:a.activity.fills}));
const dir=`docs/testing/more-trades-${new Date().toISOString().replace(/[:.]/g,'-')}`;
await mkdir(dir,{recursive:true});await writeFile(`${dir}/baseline.json`,JSON.stringify(baseline,null,2)+'\n');
const results=[];
for(const initial of state.registry.agents){
  const roundsDone=[];
  for(let round=1;round<=rounds;round++){
    state=await get();
    await post('/execution-exercise',{agentIds:[initial.id]});
    console.log(JSON.stringify({name:initial.manifest.name,round,phase:'mandate recorded'}));
    let completed=false;
    for(let attempt=1;attempt<=12;attempt++){
      await post('/cycle',{id:initial.sessionId});
      state=await get();const current=state.registry.agents.find((a:any)=>a.id===initial.id);
      console.log(JSON.stringify({name:current.manifest.name,round,attempt,phase:current.exercise.phase,fills:current.activity.fills,latest:current.activity.latest,error:current.session.error}));
      if(current.exercise.phase==='COMPLETE'){completed=true;break;}
      if(current.session.error)await new Promise(r=>setTimeout(r,5000));
    }
    if(!completed)throw new Error(`${initial.manifest.name} did not complete round ${round}; all attempts preserved.`);
    const {bundle}=await post('/agent-export',{agentId:initial.id});
    const id=bundle.paper.session.exercise.id,events=bundle.paper.events,filled=events.filter((e:any)=>e.kind==='fill'&&e.exerciseId===id);
    assert.deepEqual(filled.map((e:any)=>e.action),['BUY','SELL']);assert.equal(filled[0].quote.amountIn,'2000000');assert.equal(bundle.paper.session.portfolio.position,'0');assert.equal(bundle.agent.activity.manual,false);
    for(const f of filled){
      assert.equal(f.evidence,'operator-directed-model');assert.equal(f.quote.source,'live');assert.equal(f.quote.signatureVerified,true);
      const decision=events.filter((e:any)=>e.kind==='model'&&e.exerciseId===id&&e.sequence<f.sequence).at(-1);
      assert.equal(decision.model.id,bundle.paper.session.agent.modelId);assert.equal(JSON.parse(decision.model.raw).action,f.action);
      const input=JSON.parse(decision.model.request.messages[1].content);assert.equal(input.marketContext.executionExercise.id,id);assert.equal(input.marketContext.executionExercise.phase,f.action);
    }
    assert.deepEqual(bundle.paper.replay.portfolio,bundle.paper.session.portfolio);
    await writeFile(`${dir}/${initial.manifest.name}-evidence.json`,JSON.stringify(bundle,null,2)+'\n');
    roundsDone.push({round,exerciseId:id,filled:filled.map((e:any)=>({action:e.action,at:e.at,quoteId:e.quote.id,amountIn:e.quote.amountIn,amountOut:e.quote.amountOut,hash:e.hash}))});
  }
  const {bundle}=await post('/agent-export',{agentId:initial.id});
  results.push({name:initial.manifest.name,agentId:initial.id,additionalFills:rounds*2,totalFills:bundle.agent.activity.fills,cumulativeRealized:bundle.paper.session.portfolio.realized,position:bundle.paper.session.portfolio.position,head:bundle.paper.replay.head,rounds:roundsDone});
  await writeFile(`${dir}/verification.json`,JSON.stringify({scope:'Operator-directed model execution exercises. Live dry-run quotes; virtual capital; not autonomous strategy performance.',requestedRounds:rounds,agents:results},null,2)+'\n');
}
console.log(JSON.stringify({complete:true,directory:dir,agents:results.map(({rounds:_,...r})=>r)},null,2));
