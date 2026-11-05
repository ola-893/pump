import type {AgentVaults} from './agent-vaults.js';
import {units} from './types.js';
export async function vaultReadiness(vaults:AgentVaults,reportingErrors:{runId:string;error:string}[]=[]){
 const agents=vaults.agents,deployments=vaults.list(),runs=agents.strategies.records();
 const rows=[];
 for(const run of runs){
  const agent=agents.read(run.agentId),active=agents.strategies.active(agent.id)?.id===run.id,v=deployments.find(v=>v.runId===run.id);
  const blockers:string[]=[],row:any={agentId:agent.id,name:agent.manifest.name,runId:run.id,version:run.version,active,visibility:agents.visibility(agent),strategyHash:run.commitment,contractId:v?.contractId??null,mode:v?.mode??'missing',blockers};
  if(!v){if(active)blockers.push('No vault is attached to this current strategy.');else row.scope='Archived paper-only history; no investment vault was ever attached.';}
  else try{
   const o=await vaults.inspect(agent.id,run.id,'',true);
   row.observation={block:o.blockHeight,blockHash:o.blockHash,at:o.observedAt,version:o.state.version,assets:o.state.assets,reserve:o.state.reserve,pumpCoin:o.state.total_supply,custody:o.custodyBalance,price:o.pumpCoinPrice,navFresh:o.navFresh};
   if(active&&!v.liveNav)blockers.push('Deployed contract uses round settlement instead of live pricing.');
   if(active&&v.liveNav&&v.codeHash!==vaults.config().factory?.vaultCodeHash)blockers.push('Deployed vault code differs from the current live-pricing factory.');
   if(active&&v.liveNav&&o.navFresh===false)blockers.push('Confirmed vault pricing is out of date.');
   if(active&&v.liveNav&&units(o.state.total_supply)>0n&&units(o.state.reserve)===0n)blockers.push('Funded vault has no surplus to back simulated gains.');
   if(o.state.pending)blockers.push('A payout is still pending.');
   for(const e of reportingErrors.filter(e=>e.runId===run.id))blockers.push(e.error);
  }catch(e){blockers.push(e instanceof Error?e.message:'Vault could not be verified on-chain.');}
  row.ready=active?blockers.length===0:!!v&&blockers.length===0;rows.push(row);
 }
 const current=rows.filter(r=>r.active),publicCurrent=current.filter(r=>r.visibility==='public');
 const db=agents.paper.store.db;
 const pendingDeployments=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='near_strategy_deployments'").get()
  ? (db.prepare('SELECT body FROM near_strategy_deployments').all() as {body:string}[]).map(({body})=>{
    const draft=JSON.parse(body);return {agentId:draft.run.agentId,runId:draft.run.id,version:draft.run.version,owner:draft.owner,public:draft.public,contractId:draft.contractId,blocker:'Strategy deployment is not activated; owner wallet approval and finalized contract verification are required.'};
   }):[];
 return {schema:'PUMP-DEMO-READINESS-v1',checkedAt:new Date().toISOString(),ready:pendingDeployments.length===0&&current.length>0&&current.every(r=>r.ready),publicInvestorDemoReady:!pendingDeployments.some(d=>d.public)&&publicCurrent.length>0&&publicCurrent.every(r=>r.ready),currentStrategies:current.length,currentVerified:current.filter(r=>r.ready).length,missingCurrent:current.filter(r=>!r.contractId).length,legacyCurrent:current.filter(r=>r.mode==='paper-rounds').length,archivedWithoutVault:rows.filter(r=>!r.active&&!r.contractId).length,pendingDeployments,rows,boundary:'An audit of actual deployed custody and pricing configuration. This does not replace wallet deposit/withdrawal acceptance tests, prove model execution or approve mainnet use.'};
}
