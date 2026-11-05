import type {AgentVaults} from '../agent-vaults.js';import type {DirectoryRunner} from './runner.js';
import {publishedVaults} from './read-model.js';import {verifyHistory} from '../ledger.js';
/** The central reporter consumes recent owner-authorized runner checkpoints.
 * It retains the same global gas budget and never receives a model or its keys. */
export class DirectoryNavSource{
 readonly facade:AgentVaults;private remote=new Map<string,{entry:any;proof:any;vaults:AgentVaults}>();
 private timer?:ReturnType<typeof setInterval>;private updating:Promise<void>|null=null;private closed=false;
 private now:()=>number;
 private localVaults:AgentVaults;private runner:DirectoryRunner;
 constructor(privateVaults:AgentVaults,runner:DirectoryRunner,options:{autoStart?:boolean;now?:()=>number}={}){
  this.localVaults=privateVaults;this.runner=runner;this.now=options.now??Date.now;
  const local=privateVaults.agents,source=this;
  const strategyProxy=new Proxy(local.strategies,{get(target,key){
   if(key==='read')return(id:string)=>source.findRun(id)?.run??target.read(id);
   if(key==='export')return(id:string)=>{const found=source.findRun(id);if(!found)return target.export(id);const h=found.entry.histories[id];return {strategy:found.run,paper:{...h,replay:verifyHistory(h.session,h.events)},originProof:found.proof};};
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const storeProxy=new Proxy(local.paper.store,{get(target,key){
   if(key==='read')return(id:string)=>source.findSession(id)?.history.session??target.read(id);
   if(key==='history')return(id:string)=>source.findSession(id)?.history.events??target.history(id);
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const paperProxy=new Proxy(local.paper,{get(target,key){
   if(key==='store')return storeProxy;
   if(key==='view')return(s:any)=>source.findSession(s.id)?.run.session??target.view(s);
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  const agentsProxy=new Proxy(local,{get(target,key){if(key==='strategies')return strategyProxy;if(key==='paper')return paperProxy;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  this.facade=new Proxy(privateVaults,{get(target,key){
   if(key==='agents')return agentsProxy;
   if(key==='list')return()=>[...target.list(),...[...source.remote.values()].filter(x=>source.fresh(x.proof)).flatMap(x=>x.vaults.list())];
   if(key==='inspect')return(agentId:string,runId:string,account='',fresh=false)=>source.remoteVaults(agentId)?.inspect(agentId,runId,account,fresh)??target.inspect(agentId,runId,account,fresh);
   const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
  }});
  if(options.autoStart!==false){this.timer=setInterval(()=>void this.refresh(),10000);this.timer.unref();}
 }
 private fresh(proof:any){const age=this.now()-proof.reportedAt;return Number.isSafeInteger(proof.reportedAt)&&age>=-5000&&age<=45000;}
 private remoteVaults(agentId:string){const remote=this.remote.get(agentId);return remote&&this.fresh(remote.proof)?remote.vaults:undefined;}
 refresh():Promise<void>{
  if(this.closed)return Promise.resolve();
  if(this.updating)return this.updating;
  this.updating=this.update().finally(()=>{this.updating=null;});return this.updating;
 }
 private async update(){
  try{
   const local=this.localVaults.agents,records=await this.runner.catalog(),localIds=new Set(local.records().map(a=>a.id));
   const localRuns=new Set(local.strategies.records().map(r=>r.id)),localSessions=new Set(local.paper.store.list().map(s=>s.id));
   const usedRuns=new Set(localRuns),usedSessions=new Set(localSessions),next=new Map<string,{entry:any;proof:any;vaults:AgentVaults}>();
   for(const record of records){
    if(localIds.has(record.entry.agent.id)||record.offline||!this.fresh(record.proof))continue;
    try{
     const {entry,proof}=await this.runner.read(record.entry.agent.id);
     if(!this.fresh(proof))continue;
     if(entry.runs.some((run:{id:string;sessionId:string})=>usedRuns.has(run.id)||usedSessions.has(run.sessionId)))continue;
     const views=publishedVaults(entry,local,this.localVaults.testnet,this.localVaults.config());
     if(!views.list().length)continue;
     next.set(entry.agent.id,{entry,proof,vaults:views});
     for(const run of entry.runs){usedRuns.add(run.id);usedSessions.add(run.sessionId);}
    }catch{/* One unavailable or invalid agent does not disable other reports. */}
   }
   if(!this.closed)this.remote=next;
  }catch{/* Never keep an unreachable or rejected source eligible for fresh NAV. */this.remote.clear();}
 }
 private findRun(id:string){for(const value of this.remote.values()){if(!this.fresh(value.proof))continue;const run=value.entry.runs.find((r:any)=>r.id===id);if(run)return {...value,run};}return null;}
 private findSession(id:string){for(const value of this.remote.values()){if(!this.fresh(value.proof))continue;const run=value.entry.runs.find((r:any)=>r.sessionId===id);if(run)return {run,history:value.entry.histories[run.id]};}return null;}
 close(){this.closed=true;clearInterval(this.timer);this.remote.clear();}
}
