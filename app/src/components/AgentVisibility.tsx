import { useState } from 'react';
import type { ConsoleAgent, ConsoleRun } from './AgentConsole';
import { useNearWallet, NearWalletButton } from './NearWalletProvider';
import { sendDeploymentPlan } from '../lib/vault-deployment-wallet';
import './AgentVisibility.css';
type Props={agent:ConsoleAgent;runs:ConsoleRun[];deployed:boolean;api:(path:string,body?:unknown)=>Promise<any>;refresh:()=>Promise<void>};
export function AgentVisibility({agent,runs,deployed,api,refresh}:Props){
 const wallet=useNearWallet();
 const visibility=agent.visibility??'public', [review,setReview]=useState(false),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function update(){if(visibility!=='private'||!accepted||busy)return;setBusy(true);setError('');try{
  if(deployed&&visibility==='private'){
    if(wallet.account!==agent.manifest.controller)throw new Error('Connect the agent owner’s wallet to publish this vault.');
    const {plan}=await api('/strategy-publish-plan',{agentId:agent.id,account:wallet.account});
    if(plan)await sendDeploymentPlan(plan,wallet.account,agent.id);
  }
  await api('/agent-visibility',{agentId:agent.id,visibility:'public',expectedVisibility:'private'});await refresh();setReview(false);setAccepted(false);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 return <section className="av-visibility" aria-label="Agent visibility"><div><strong>{visibility==='private'?'Private agent':'Public agent'}</strong><p>{visibility==='private'?'Only available in this computer’s owner workspace. Hidden from Explore agents and Leaderboard; investor deposits are disabled.':'Investors can inspect this agent, its registered mandate, saved strategy versions and trading record.'}</p></div>{visibility==='public'?<small>Public agents stay public. Publication cannot be reversed.</small>:<button type="button" className="nd-button secondary" onClick={()=>{setReview(!review);setAccepted(false);setError('');}}>Review publication</button>}
 {review&&visibility==='private'&&<div className="av-publication" role="region" aria-label="Review agent visibility"><h3>Review before publishing</h3><p>Publishing shares your agent identity, registered mandate, every saved strategy version and its trading record. Your model weights stay on your computer. Future saved strategy versions will also be public. Once published, this agent cannot become private again.</p>{visibility==='private'&&<details><summary>Inspect strategy instructions to be published</summary><h4>Registration mandate</h4><pre>{agent.manifest.strategy?.description??agent.session.config.strategy}</pre>{runs.filter(r=>r.agentId===agent.id).map(r=><div key={r.id}><h4>v{r.version} · {r.label}</h4><pre>{r.config.strategy}</pre></div>)}</details>}<label><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>I agree to permanently publish this agent and all saved strategy instructions and records.</label><div className="nd-buttons">{deployed&&visibility==='private'&&wallet.account!==agent.manifest.controller&&<NearWalletButton/>}<button type="button" className="nd-button" disabled={!accepted||busy||deployed&&visibility==='private'&&wallet.account!==agent.manifest.controller} onClick={()=>void update()}>{busy?'Publishing…':'Publish agent'}</button><button type="button" className="nd-button secondary" disabled={busy} onClick={()=>setReview(false)}>Cancel</button></div></div>}{error&&<p role="alert" className="nd-alert">{error}</p>}</section>;
}
