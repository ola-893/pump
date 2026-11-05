import { randomUUID } from 'node:crypto';
import type { NearAgents } from './agents.js';
import { exerciseGuidance } from './exercise.js';
import { canonical } from './ledger.js';
import { units } from './types.js';
export type ContinuousState={enabled:boolean;runId:string;agentIds:string[];targetPerAgent:50;startedAt:string;updatedAt:string;activeAgentId:string|null;phase:string;error:string|null;ownerPid:number;cursor:number;batchRemaining:number};
/** Persistent operator authorization, with one sequential inference at a time. */
export class ContinuousTrading {
  private timer?:ReturnType<typeof setTimeout>;private closed=false;private inFlight=false;private owned='';
  readonly agents:NearAgents;
  private options:{autoResume?:boolean;delayMs?:number};
  constructor(agents:NearAgents,options:{autoResume?:boolean;delayMs?:number}={}){
    this.agents=agents;this.options=options;
    agents.paper.store.db.exec('CREATE TABLE IF NOT EXISTS near_continuous(id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    const saved=this.status();if(saved?.enabled&&options.autoResume!==false){this.owned=saved.runId;this.schedule(1000);}
  }
  status():ContinuousState|null{const row=this.agents.paper.store.db.prepare('SELECT body FROM near_continuous WHERE id=1').get() as {body:string}|undefined;return row?JSON.parse(row.body):null;}
  private save(s:ContinuousState){s.updatedAt=new Date().toISOString();this.agents.paper.store.db.prepare('INSERT INTO near_continuous(id,body) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(canonical(s));}
  start(ids:string[]){
    if(this.closed)throw new Error('Continuous trader is shutting down.');
    if(this.status()?.enabled)throw new Error('Continuous paper trading is already enabled.');
    if(this.inFlight||this.agents.paper.busy||this.agents.paper.list().some(s=>s.state==='running')||this.agents.runs().some(r=>r.state==='running'))throw new Error('Wait for current workers and comparisons to stop first.');
    if(!Array.isArray(ids)||!ids.length||ids.length>8||new Set(ids).size!==ids.length)throw new Error('Select one to eight distinct agents.');
    for(const id of ids){const a=this.agents.read(id),s=this.agents.paper.store.read(a.sessionId);if(s.testnet)throw new Error('Continuous exercise is for virtual-only sessions.');if(!s.exercise||exerciseGuidance(s,this.agents.paper.store.history(s.id))?.phase==='COMPLETE')this.agents.paper.checkExercise(s.id);}
    const now=new Date().toISOString(),state:ContinuousState={enabled:true,runId:randomUUID(),agentIds:ids,targetPerAgent:50,startedAt:now,updatedAt:now,activeAgentId:null,phase:'queued',error:null,ownerPid:process.pid,cursor:0,batchRemaining:6};
    this.owned=state.runId;this.save(state);this.schedule(0);return state;
  }
  stop(){const s=this.status();if(s){s.enabled=false;s.phase=this.inFlight?'stopping after active decision':'stopped';s.activeAgentId=this.inFlight?s.activeAgentId:null;this.save(s);}clearTimeout(this.timer);this.timer=undefined;return this.status();}
  private schedule(ms:number){if(this.closed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>void this.tick(),ms);this.timer.unref();}
  async tick(){
    if(this.closed||this.inFlight)return;let control=this.status();if(!control?.enabled||control.runId!==this.owned)return;
    this.inFlight=true;let wait=this.options.delayMs??1000;
    try{
      control.ownerPid=process.pid;
      const records=control.agentIds.map(id=>this.agents.read(id));
      let chosen=records[control.cursor%records.length];
      const eligible=(a:typeof chosen)=>{const s=this.agents.paper.store.read(a.sessionId),phase=exerciseGuidance(s,this.agents.paper.store.history(s.id))?.phase;if(phase&&phase!=='COMPLETE')return true;const used=s.turnover.day===new Date().toISOString().slice(0,10)?units(s.turnover.used):0n;return units(s.config.dailyTurnoverCap)-used>=4100000n;};
      if(!eligible(chosen)){const index=records.findIndex(eligible);if(index<0){control.phase='waiting for UTC turnover reset';control.activeAgentId=null;control.error=null;this.save(control);wait=60000;return;}control.cursor=index;control.batchRemaining=6;chosen=records[index];}
      const session=this.agents.paper.store.read(chosen.sessionId),phase=exerciseGuidance(session,this.agents.paper.store.history(session.id))?.phase;
      control.phase='running';control.activeAgentId=chosen.id;control.error=null;this.save(control);
      if(!phase||phase==='COMPLETE')await this.agents.paper.requestExercise(session.id);
      const before=this.agents.paper.store.history(session.id).filter(e=>e.kind==='fill').length;
      const result=await this.agents.paper.cycle(session.id);
      const after=this.agents.paper.store.history(session.id).filter(e=>e.kind==='fill').length;
      // Stop may arrive while inference is running. Never restore its old enabled flag.
      const latest=this.status();if(!latest||latest.runId!==control.runId)return;control={...latest};
      control.batchRemaining-=after-before;control.activeAgentId=null;
      control.error=result.error;control.phase=control.enabled?result.error?'retrying':'running':'stopped';
      if(control.batchRemaining<=0&&exerciseGuidance(this.agents.paper.store.read(session.id),this.agents.paper.store.history(session.id))?.phase==='COMPLETE'){control.cursor=(control.cursor+1)%records.length;control.batchRemaining=6;}
      this.save(control);if(result.error)wait=15000;
    }catch(e){const latest=this.status();if(latest&&latest.runId===this.owned){latest.error=e instanceof Error?e.message:'Continuous paper cycle failed.';latest.activeAgentId=null;latest.phase=latest.enabled?'retrying':'stopped';this.save(latest);}wait=15000;}
    finally{this.inFlight=false;if(this.status()?.enabled&&!this.closed)this.schedule(wait);}
  }
  close(){this.closed=true;clearTimeout(this.timer);}
}
