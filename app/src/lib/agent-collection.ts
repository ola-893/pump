import type { JournalListing } from '../../../near-demo/directory/public-journal.js';

export type CollectionAgent={visibility?:'private'|'public';id:string;createdAt?:string;journalUpdatedAt?:string;strategyVault?:string;manifest:{name:string;controller?:string;model:{id:string};strategy?:{description:string}}};

export function catalogAgents(registry: CollectionAgent[], journals: JournalListing[]): CollectionAgent[] {
 const known = new Set(registry.map(agent => agent.id));
 const agents = registry.filter(agent => agent.visibility !== 'private');
 for (const journal of journals) {
  if (known.has(journal.id)) continue;
  known.add(journal.id);
  agents.push({
   id: journal.id, visibility: 'public', journalUpdatedAt: new Date(journal.updatedAt).toISOString(),strategyVault:journal.strategyVault,
   manifest: { name: journal.name, controller: journal.controller, model: { id: journal.model } },
  });
 }
 return agents;
}
export type CollectionRun={id:string;agentId:string;version:number;label:string;createdAt:string;session:{state:string;error?:string|null;valuationStale?:boolean;metrics:{total:string|null};portfolio:{maxDrawdownBps:number}};activity:{fills:number;decisions:number}};
export type AgentEntry<A extends CollectionAgent=CollectionAgent>={agent:A;run?:CollectionRun;returnPct:number|null;drawdown:number|null;state:'running'|'stopped'|'unconfigured'|'attention';funded:boolean};
export function matchesController(controller?:string, account?:string) {
 return !!account&&controller?.toLowerCase()===account.toLowerCase();
}
export function agentEntries<A extends CollectionAgent>(agents:A[],runs:(CollectionRun&{config:{initialCash:string}})[],vaults:{agentId:string;contractId:string|null}[]=[]):AgentEntry<A>[] {
 const latest=new Map<string,typeof runs[number]>(),working=new Map<string,typeof runs[number]>();for(const r of runs){if(!latest.has(r.agentId)||latest.get(r.agentId)!.version<r.version)latest.set(r.agentId,r);if(r.session.state==='running')working.set(r.agentId,r);}
 const deployed=new Set(vaults.filter(v=>v.contractId).map(v=>v.agentId));
 return agents.map(agent=>{const run=latest.get(agent.id),active=working.get(agent.id),total=run?.session.metrics.total;return {agent,run,returnPct:run&&run.activity.decisions>0&&total!=null&&!run.session.valuationStale&&Number(run.config.initialCash)>0?Number(total)*100/Number(run.config.initialCash):null,drawdown:run&&run.activity.decisions>0?run.session.portfolio.maxDrawdownBps/100:null,state:active?active.session.error?'attention':'running':run?.session.error?'attention':run?.session.state==='running'?'running':run?'stopped':'unconfigured',funded:deployed.has(agent.id)||!!agent.strategyVault};});
}
export function selectAgents<A extends CollectionAgent>(entries:AgentEntry<A>[],options:{query?:string;filter?:string;sort?:string;account?:string;mine?:boolean}) {
 const terms=(options.query??'').toLowerCase().trim().split(/\s+/).filter(Boolean);
 const found=entries.filter(e=>{
  if(options.mine&&!matchesController(e.agent.manifest.controller,options.account))return false;
  const text=[e.agent.manifest.name,e.agent.manifest.model.id,e.agent.manifest.controller,e.agent.manifest.strategy?.description,e.run?.label,e.agent.id].join(' ').toLowerCase();
  if(!terms.every(t=>text.includes(t)))return false;
  return !options.filter||options.filter==='all'||options.filter==='record'&&(e.run?.activity.fills??0)>0||options.filter==='running'&&e.state==='running'||options.filter==='stopped'&&e.state==='stopped'||options.filter==='attention'&&e.state==='attention'||options.filter==='unconfigured'&&e.state==='unconfigured'&&!e.agent.journalUpdatedAt||options.filter==='vault'&&e.funded;
 });
 const recent=(a:CollectionAgent)=>a.journalUpdatedAt??a.createdAt??'';
 const newest=(a:AgentEntry<A>,b:AgentEntry<A>)=>recent(b.agent).localeCompare(recent(a.agent))||a.agent.id.localeCompare(b.agent.id);
 return found.sort((a,b)=>{
  if(options.sort==='name')return a.agent.manifest.name.localeCompare(b.agent.manifest.name)||newest(a,b);
  if(options.sort==='orders')return (b.run?.activity.fills??0)-(a.run?.activity.fills??0)||newest(a,b);
  if(options.sort==='return'||options.sort==='drawdown'){const x=options.sort==='return'?a.returnPct:a.drawdown,y=options.sort==='return'?b.returnPct:b.drawdown;if(x===null||y===null)return x===y?newest(a,b):x===null?1:-1;return (options.sort==='return'?y-x:x-y)||newest(a,b);}
  return newest(a,b);
 });
}
export function collectionPage<T>(items:T[],requested:string|number|null,size=12){const n=Number(requested),pages=Math.max(1,Math.ceil(items.length/size)),page=Math.min(pages,Math.max(1,Number.isSafeInteger(n)?n:1));return {items:items.slice((page-1)*size,page*size),page,pages,total:items.length,start:items.length?(page-1)*size+1:0,end:Math.min(page*size,items.length)};}
export function collectionLink(path:string,params:URLSearchParams,agent?:string){const next=new URLSearchParams(params);if(agent)next.set('agent',agent);else next.delete('agent');return path+(next.size?'?'+next.toString():'');}
