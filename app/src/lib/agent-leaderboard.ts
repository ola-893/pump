import type { MarketSelection } from '../../../near-demo/types.js';
import { agentEntries, selectAgents, type CollectionAgent, type CollectionRun } from './agent-collection.js';
export type LeaderboardRun=CollectionRun&{config:{initialCash:string;market?:MarketSelection};session:{portfolio:{position:string;markAt:string|null}};activity:{buys:number;sells:number;volume:string}};
export type LeaderboardEntry=ReturnType<typeof leaderboardEntries>[number];
export type RankMetric='return'|'drawdown';
export function leaderboardEntries(agents:CollectionAgent[],runs:LeaderboardRun[],vaults:{agentId:string;contractId:string|null}[]=[]){
 const versions=new Map(runs.map(r=>[r.id,r]));
 return agentEntries(agents.filter(a=>a.visibility!=='private'),runs,vaults).map(e=>{
  const run=e.run?versions.get(e.run.id):undefined;
  const reason=!run?'No saved strategy':!run.activity.decisions?'No model decisions':!run.activity.fills?'No filled orders':run.session.valuationStale?'Valuation stale':e.returnPct===null||!Number.isFinite(e.returnPct)?'Valuation unavailable':e.drawdown===null||!Number.isFinite(e.drawdown)||e.drawdown<0?'Risk record unavailable':null;
  return {...e,run,rankReason:reason,eligible:reason===null};
 });
}
export function rankLeaderboard(entries:LeaderboardEntry[],metric:RankMetric){
 const sorted=[...entries].sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(a.eligible&&b.eligible?(metric==='drawdown'?a.drawdown!-b.drawdown!:b.returnPct!-a.returnPct!):0)||a.agent.id.localeCompare(b.agent.id));
 const ranks=new Map<string,number>();let previous:number|undefined,rank=0,index=0;
 for(const e of sorted){if(!e.eligible)continue;const value=metric==='drawdown'?e.drawdown!:e.returnPct!;++index;if(previous!==value)rank=index;ranks.set(e.agent.id,rank);previous=value;}
 return {sorted,ranks};
}
export function filterLeaderboard(entries:LeaderboardEntry[],options:{query?:string;status?:string;model?:string;minFills?:number}){
 const ids=new Set(selectAgents(entries,{query:options.query}).map(e=>e.agent.id));
 return entries.filter(e=>ids.has(e.agent.id)&&(!options.model||e.agent.manifest.model.id===options.model)&&(!options.status||options.status==='all'||options.status==='ranked'&&e.eligible||options.status==='unranked'&&!e.eligible||options.status==='running'&&e.state==='running')&&(e.run?.activity.fills??0)>=(options.minFills??0));
}
export function leaderboardDetailLink(params:URLSearchParams,id:string){const q=new URLSearchParams(params);q.set('agent',id);q.set('from','leaderboard');return '/vaults?'+q.toString();}
