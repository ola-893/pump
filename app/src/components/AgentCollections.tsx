import { hostedApp } from '../lib/hosting';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, Cpu, Search, Plus, ArrowLeft, SlidersHorizontal } from 'lucide-react';
import { useNearWallet, NearWalletButton } from './NearWalletProvider';
import { agentEntries, catalogAgents, selectAgents, collectionPage, collectionLink, type CollectionAgent, type AgentEntry } from '../lib/agent-collection';
import { readJournalCatalog } from '../lib/public-journal-client';
import type { JournalListing } from '../../../near-demo/directory/public-journal';
import type { ConsoleRun } from './AgentConsole';
import './AgentCollections.css';
const pct=(n:number|null)=>n===null?'—':`${n>0?'+':''}${n.toFixed(2)}%`;
const state=(e:AgentEntry)=>e.state==='unconfigured'?'Strategy needed':e.state==='running'?'Running':e.state==='attention'?'Needs attention':'Stopped';
const short=(s:string)=>s.length>28?s.slice(0,14)+'…'+s.slice(-8):s;
export function CollectionPagination({page,pages,start,end,total,onPage}:{page:number;pages:number;start:number;end:number;total:number;onPage:(n:number)=>void}){return <div className="ag-pagination"><span>{start}–{end} of {total} agents</span><nav aria-label="Agent results pages"><button className="nd-button secondary" disabled={page===1} onClick={()=>onPage(page-1)}>Previous</button><span>Page {page} of {pages}</span><button className="nd-button secondary" disabled={page===pages} onClick={()=>onPage(page+1)}>Next</button></nav></div>;}
type CatalogProps = {agents:CollectionAgent[];runs:ConsoleRun[];vaults:{agentId:string;contractId:string|null}[]};
export function ExploreAgentCatalog({agents,runs,vaults,loading}:CatalogProps & {loading:boolean}) {
 const [journals,setJournals]=useState<JournalListing[]>();
 const [error,setError]=useState(false);
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(!hostedApp)return;
  const request=new AbortController();
  void readJournalCatalog(request.signal).then(result=>{
   if(!request.signal.aborted)setJournals(result);
  }).catch(()=>{
   if(!request.signal.aborted)setError(true);
  });
  return ()=>request.abort();
 },[attempt]);
 if(hostedApp ? !journals&&!error : loading)return <p role="status">Loading agents…</p>;
 return <>
  {error&&<p role="alert" className="nd-alert">Could not load agents with public journals. <button className="nd-text-button" onClick={()=>{setError(false);setAttempt(n=>n+1);}}>Retry</button></p>}
  <AgentCatalog agents={catalogAgents(agents,journals??[])} runs={runs} vaults={vaults} incomplete={error||loading}/>
 </>;
}

function AgentCatalog({agents,runs,vaults,incomplete}:CatalogProps & {incomplete:boolean}){
 const [params,setParams]=useSearchParams(),{account}=useNearWallet(),path='/vaults';
 const query=params.get('q')??'',filter=params.get('filter')??'all',sort=params.get('sort')??'newest';
 const entries=agentEntries(agents,runs,vaults),matches=selectAgents(entries,{query,filter,sort,account,mine:params.get('scope')==='mine'}),page=collectionPage(matches,params.get('page'));
 function change(key:string,value:string){const next=new URLSearchParams(params);next.delete('agent');next.delete('page');if(value)next.set(key,value);else next.delete(key);setParams(next,{replace:key==='q'});}
 return <section className="ag-catalog"><div className="nd-title"><div><div className="nd-eyebrow">EXPLORE AGENTS</div><h1>Discover independent trading agents.</h1><p>Explore local AI models built by independent creators. Find a strategy, inspect its record, and meet the person behind it.</p></div><Link className="nd-button" to="/register"><Plus size={15}/>Create an agent</Link></div>
 <div className="ag-overview"><span><strong>{agents.length}</strong> agents</span><span><strong>{new Set(agents.map(a=>a.manifest.controller).filter(Boolean)).size}</strong> declared creators</span><span><strong>{entries.filter(e=>(e.run?.activity.fills??0)>0).length}</strong> with recorded fills</span><span>Local inference · NEAR testnet</span></div>
 <div className="ag-toolbar"><label className="ag-search"><Search size={16}/><input aria-label="Search agents" placeholder="Search agents, models, strategies or creators" value={query} onChange={e=>change('q',e.target.value)}/></label><label className="ag-filter"><span><SlidersHorizontal size={12}/>Record</span><select aria-label="Filter agents" value={filter} onChange={e=>change('filter',e.target.value)}><option value="all">All agents</option><option value="record">With trading records</option><option value="running">Running now</option><option value="unconfigured">New · strategy needed</option><option value="vault">Vault available</option></select></label><label className="ag-filter">Sort by<select aria-label="Sort agents" value={sort} onChange={e=>change('sort',e.target.value)}><option value="newest">{hostedApp?'Most recent activity':'Newest agents'}</option><option value="return">Paper return · highest</option><option value="drawdown">Drawdown · lowest</option><option value="orders">Filled orders · most</option><option value="name">Name · A–Z</option></select></label></div>
 <div className="ag-results-head"><span>{matches.length} {matches.length===1?'agent':'agents'}{query?` matching “${query}”`:''}</span><div>{account&&<button className="nd-text-button" type="button" aria-pressed={params.get('scope')==='mine'} onClick={()=>change('scope',params.get('scope')==='mine'?'':'mine')}>{params.get('scope')==='mine'?'Showing my declared agents':'Show my declared agents'}</button>}{(query||params.has('filter')||params.has('scope'))&&<button className="nd-text-button" onClick={()=>setParams({})}>Clear filters</button>}</div></div>

 {!page.total ? !incomplete&&<div className="nd-card ag-empty"><Search size={28}/><h2>{agents.length?'No agents match this view.':'Be the first to create an agent.'}</h2><p>{agents.length?'Try another search or remove a filter.':'Bring a local model and give it a strategy. Every creator starts with their own agent.'}</p><Link className="nd-button" to="/register">Create an agent <ArrowRight size={14}/></Link></div> :
  <div className="ag-grid">{page.items.map(e=>{
   const {agent,run}=e;
   const journal=!!agent.journalUpdatedAt;
   const href=collectionLink(path,params,agent.id);
   return <Link className="nd-card ag-agent-card" key={agent.id} to={href}>
    <div className="ag-card-heading"><span className="ag-avatar"><Cpu size={20}/></span><div><h2>{agent.manifest.name}</h2><small title={agent.manifest.controller}>by {short(agent.manifest.controller??'Undeclared creator')}</small></div><ArrowRight size={15}/></div>
    <p className="ag-model">{agent.manifest.model.id}</p>
    {journal?<><h3>Public trading record</h3><p className="ag-mandate">Inspect the published paper trading record.</p><div className="ag-card-footer"><span>View agent</span></div></>:<>
     <h3>{run?.label??'A new strategy starts here.'}</h3><p className="ag-mandate">{agent.manifest.strategy?.description??'Inspect the public mandate and model declaration.'}</p>
     <div className="ag-card-metrics"><div><small>Paper return</small><strong className={e.returnPct!==null&&e.returnPct<0?'negative':'positive'}>{pct(e.returnPct)}</strong></div><div><small>Max drawdown</small><strong>{e.drawdown===null?'—':e.drawdown.toFixed(2)+'%'}</strong></div><div><small>Filled orders</small><strong>{run?.activity.fills??0}</strong></div></div>
     <div className="ag-card-footer"><span>{run?`Strategy v${run.version}`:'No performance yet'}</span><span>{e.funded?'Testnet vault':'Vault pending'}</span></div>
    </>}
   </Link>;
  })}</div>}
 <CollectionPagination {...page} onPage={n=>change('page',String(n))}/><p className="ag-note">Returns belong to the displayed strategy version. Earlier execution exercises are excluded. Creator accounts are declarations; model measurements are local consistency checks.</p>
 </section>;
}
export function CreatorAgents({agents,runs,onOpen}:{agents:CollectionAgent[];runs:ConsoleRun[];onOpen:(id:string)=>void}){
 const [params,setParams]=useSearchParams(),wallet=useNearWallet(),scope=params.get('scope')??(wallet.account?'mine':'local'),query=params.get('q')??'',filter=params.get('filter')??'all';
 const entries=agentEntries(agents,runs),scoped=selectAgents(entries,{mine:scope==='mine',account:wallet.account}),matches=selectAgents(scoped,{query,filter,sort:params.get('sort')??'newest'}),page=collectionPage(matches,params.get('page'),10);
 function change(key:string,value:string){const next=new URLSearchParams(params);next.delete('agent');next.delete('page');if(value)next.set(key,value);else next.delete(key);setParams(next,{replace:key==='q'});}
 return <section className="ag-workspace"><div className="nd-title"><div><div className="nd-eyebrow">CREATOR WORKSPACE</div><h1>My agents</h1><p>Create an agent, give it a strategy, and follow its decisions. Each agent has its own identity, versions and trading record.</p></div><Link className="nd-button" to="/register"><Plus size={15}/>Create an agent</Link></div><div className="ag-workspace-scope"><div role="group" aria-label="Agent workspace scope"><button type="button" aria-pressed={scope==='mine'} onClick={()=>change('scope','mine')}>Connected wallet</button><button type="button" aria-pressed={scope==='local'} onClick={()=>change('scope','local')}>On this computer</button></div><span>{scope==='mine'?wallet.account||'Connect a wallet to match its declared agents':hostedApp?'Registrations saved in this browser':'Registrations saved by this computer’s local helper'}</span></div>{scope==='mine'&&!wallet.account?<div className="nd-card ag-empty"><h2>Your agents, under your account.</h2><p>Connect your NEAR wallet to find agents with a matching controller declaration, or open this computer’s local workspace.</p><NearWalletButton/></div>:<><div className="ag-overview"><span><strong>{scoped.length}</strong> agents in this workspace</span><span><strong>{scoped.filter(e=>e.state==='running').length}</strong> running</span><span><strong>{scoped.filter(e=>e.state==='attention').length}</strong> need attention</span><span><strong>{scoped.filter(e=>e.state==='unconfigured').length}</strong> need a strategy</span></div><div className="ag-toolbar"><label className="ag-search"><Search size={16}/><input aria-label="Search my agents" placeholder="Search your agents, models or strategies" value={query} onChange={e=>change('q',e.target.value)}/></label><label className="ag-filter">Status<select aria-label="Filter my agents" value={filter} onChange={e=>change('filter',e.target.value)}><option value="all">All statuses</option><option value="running">Running</option><option value="stopped">Stopped</option><option value="attention">Needs attention</option><option value="unconfigured">Strategy needed</option></select></label><label className="ag-filter">Sort by<select aria-label="Sort my agents" value={params.get('sort')??'newest'} onChange={e=>change('sort',e.target.value)}><option value="newest">Newest first</option><option value="name">Name · A–Z</option><option value="orders">Filled orders</option></select></label></div>{!matches.length?<div className="nd-card ag-empty"><h2>{query||filter!=='all'?'No agents match this view.':'Create your first agent.'}</h2><p>{scope==='mine'?'No matching declaration is shown for this wallet and filter.':'Bring a downloaded model and describe the strategy you want it to run.'}</p><Link className="nd-button" to="/register">Create an agent <ArrowRight size={14}/></Link>{(query||filter!=='all')&&<button className="nd-text-button" onClick={()=>{const n=new URLSearchParams();n.set('scope',scope);setParams(n);}}>Clear filters</button>}</div>:<div className="nd-card ag-owner-list">{page.items.map(e=><div className="ag-owner-row" key={e.agent.id}><span className="ag-avatar"><Cpu size={18}/></span><div className="ag-owner-identity"><h2><button onClick={()=>onOpen(e.agent.id)}>{e.agent.manifest.name}</button></h2><p>{e.agent.manifest.model.id}</p><small title={e.agent.manifest.controller}>{short(e.agent.manifest.controller??'Undeclared controller')} · {e.agent.visibility==='private'?'Private':'Public'}</small></div><span className={'ag-state '+e.state}>{state(e)}</span><div className="ag-owner-record"><strong>{e.run?.activity.fills??0} fills</strong><small>{e.run?`v${e.run.version} · ${e.run.label}`:'No strategy saved'}</small></div><Link className="nd-text-button" to={e.agent.visibility==='private'?`/console?agent=${e.agent.id}&scope=local&panel=identity`:hostedApp?`/public-journal/${e.agent.id}`:`/vaults?agent=${e.agent.id}`}>{e.agent.visibility==='private'?'Private identity':'Public profile'}</Link><button className="nd-button secondary" onClick={()=>onOpen(e.agent.id)}>Open console <ArrowRight size={13}/></button></div>)}</div>}<CollectionPagination {...page} onPage={n=>change('page',String(n))}/></>}
 <p className="ag-note">The connected-wallet view matches the controller declared at registration.</p></section>;
}
export function AgentBackLink({to,children}:{to:string;children:string}){return <Link className="nd-text-button ag-back" to={to}><ArrowLeft size={14}/>{children}</Link>;}
