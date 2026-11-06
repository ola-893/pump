import { verifyStrategyDecisions } from './directory/strategy-evidence.js';
import { randomUUID } from 'node:crypto';
import type { AgentRecord } from './agents.js';
import type { PaperDemo } from './service.js';
import { canonical, digest } from './ledger.js';
import { validateConfig, units, type Session, type Event } from './types.js';
import type { StrategyRun, StrategySettings } from './public-types.js';
export type { StrategyRun, StrategySettings } from './public-types.js';
export class StrategyRuns {
  readonly paper:PaperDemo;
  beforeAction?: (run:StrategyRun, action:string)=>Promise<void>;
  afterAction?: (run:StrategyRun, action:string)=>Promise<void>;
  private agent:(id:string)=>AgentRecord;
  private available:()=>void;
  constructor(paper:PaperDemo,agent:(id:string)=>AgentRecord,available:()=>void){this.paper=paper;this.agent=agent;this.available=available;paper.setStrategyGuard(id=>this.assertActive(this.read(id)));paper.store.db.exec('CREATE TABLE IF NOT EXISTS near_strategy_runs(id TEXT PRIMARY KEY, body TEXT NOT NULL)');}
  records(){return (this.paper.store.db.prepare('SELECT body FROM near_strategy_runs ORDER BY rowid DESC').all() as {body:string}[]).map(r=>JSON.parse(r.body) as StrategyRun);}
  read(id:string){const row=this.paper.store.db.prepare('SELECT body FROM near_strategy_runs WHERE id=?').get(id) as {body:string}|undefined;if(!row)throw new Error('Strategy version not found.');const run=JSON.parse(row.body) as StrategyRun;const {commitment,...body}=run;if(digest(body)!==commitment)throw new Error('Strategy version commitment is inconsistent.');return run;}
  verify(s:Session){
    if(!s.agent?.strategyRunId)throw new Error('Session is not a strategy portfolio.');
    const r=this.read(s.agent.strategyRunId),a=this.agent(r.agentId);
    if(r.sessionId!==s.id||r.agentId!==s.agent.id||r.registrationCommitment!==a.commitment||digest(a.manifest)!==a.commitment||a.local.modelId!==s.agent.modelId||a.manifest.model.sha256!==s.agent.weightsHash||digest(r.config)!==digest(s.config)||s.exercise||s.testnet)throw new Error('Strategy portfolio does not match its saved version and model binding.');return r;
  }
  private idleAgent(agentId:string){for(const s of this.paper.store.list())if(s.agent?.id===agentId&&(this.paper.view(s).state==='running'||this.paper.execution.activeId===s.id||this.paper.execution.queued.includes(s.id)))throw new Error('Stop this agent and wait for its active decision before saving or starting another version.');}
  active(agentId:string){
    const row=this.paper.store.db.prepare("SELECT id FROM near_strategy_runs WHERE json_extract(body,'$.agentId')=? ORDER BY rowid DESC LIMIT 1").get(agentId) as {id:string}|undefined;
    return row?this.read(row.id):undefined;
  }
  assertActive(run:StrategyRun){
    if(this.active(run.agentId)?.id!==run.id)throw new Error('This strategy is archived. Use the current version to trade.');
  }
  prepare(agentId:string,expectedVersion:number,settings:StrategySettings){
    this.available();const a=this.agent(agentId);this.idleAgent(agentId);
    if(!settings||Object.keys(settings).filter(k=>k!=='market').sort().join()!=='dailyTurnoverCap,exposureCap,initialCash,intervalMs,label,slippageBps,strategy,tradeCap')throw new Error('Invalid strategy settings.');
    if(typeof settings.label!=='string'||!settings.label.trim()||settings.label.length>80||typeof settings.strategy!=='string'||settings.strategy.trim().length<20)throw new Error('Name the strategy and describe its entry, exit and HOLD conditions.');
    const previous=this.records().filter(r=>r.agentId===agentId),latest=Math.max(0,...previous.map(r=>r.version));if(!Number.isSafeInteger(expectedVersion)||expectedVersion!==latest)throw new Error('A newer strategy version was saved. Refresh before saving again.');
    const config=validateConfig({name:a.manifest.name,initialCash:settings.initialCash,tradeCap:settings.tradeCap,exposureCap:settings.exposureCap,dailyTurnoverCap:settings.dailyTurnoverCap,slippageBps:settings.slippageBps,executionDelayMs:1500,maxQuoteAgeMs:30000,source:'live',endpoint:this.paper.store.read(a.sessionId).config.endpoint,strategy:settings.strategy.trim(),intervalMs:settings.intervalMs,...(Object.hasOwn(settings,'market')?{market:settings.market}:{})});
    const body={schema:'PUMP-STRATEGY-RUN-v1' as const,id:randomUUID(),agentId,version:latest+1,
      createdAt:new Date().toISOString(),label:settings.label.trim(),registrationCommitment:a.commitment,
      sessionId:randomUUID(),config};
    return {...body,commitment:digest(body)};
  }
  activate(run:StrategyRun,recordVault:()=>void){
    this.available();
    this.idleAgent(run.agentId);
    const a=this.agent(run.agentId),{commitment,...body}=run;
    if(digest(body)!==commitment||a.commitment!==run.registrationCommitment)throw new Error('Strategy draft identity changed.');
    const db=this.paper.store.db;
    db.exec('BEGIN IMMEDIATE');
    try{
      if((this.active(run.agentId)?.version??0)+1!==run.version)throw new Error('A newer strategy version was saved. Refresh before saving again.');
      const session=this.paper.create(run.config,run.sessionId);
      const bound:Session={...this.paper.store.read(session.id),agent:{id:a.id,modelId:a.local.modelId,
        weightsHash:a.manifest.model.sha256,strategyRunId:run.id}};
      db.prepare('UPDATE sessions SET body=? WHERE id=?').run(canonical(bound),session.id);
      db.prepare('INSERT INTO near_strategy_runs(id,body) VALUES(?,?)').run(run.id,canonical(run));
      recordVault();
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    return this.view(run);
  }
  save(agentId:string,expectedVersion:number,settings:StrategySettings){
    return this.activate(this.prepare(agentId,expectedVersion,settings),()=>{});
  }
  view(run:StrategyRun){const s=this.paper.store.read(run.sessionId);this.verify(s);const events=this.paper.store.history(s.id),decisions=events.filter(e=>e.kind==='model'&&e.evidence==='live-local-model'),fills=events.filter(e=>e.kind==='fill'&&['live-local-model','operator-exit'].includes(e.evidence));const gross=fills.reduce((sum,e)=>sum+units(e.action==='BUY'?e.quote!.amountIn:e.quote!.amountOut),0n);
    return {...run,archived:this.active(run.agentId)?.id!==run.id,session:this.paper.view(s),activity:{operatorExits:fills.filter(e=>e.evidence==='operator-exit').length,decisions:decisions.length,buys:fills.filter(e=>e.action==='BUY').length,sells:fills.filter(e=>e.action==='SELL').length,fills:fills.length,holds:events.filter(e=>e.kind==='hold').length,blocked:events.filter(e=>e.kind==='blocked').length,volume:String(gross),latest:decisions.at(-1)?{at:decisions.at(-1)!.at,proposal:decisions.at(-1)!.model?.proposal}:null}};
  }
  list(){return this.records().map(r=>this.view(r));}
  async operatorExit(id:string,expectedPosition:string,lastFillHash:string){
    const r=this.read(id);this.verify(this.paper.store.read(r.sessionId));this.assertActive(r);this.idleAgent(r.agentId);
    const session=await this.paper.operatorExit(r.sessionId,expectedPosition,lastFillHash);
    await this.afterAction?.(r,'operator-exit');return {session};
  }
  async action(id:string,action:string){const r=this.read(id),s=this.paper.store.read(r.sessionId);this.verify(s);
    if(action==='stop'){
      const session=this.paper.stop(s.id);
      await this.afterAction?.(r,action);
      return {session};
    }
    this.available();
    if(action==='start'){this.idleAgent(r.agentId);await this.beforeAction?.(r,action);return {session:this.paper.start(s.id)};}
    if(action==='cycle'){if(this.paper.view(s).state==='running')throw new Error('Stop the loop before requesting a single decision.');this.idleAgent(r.agentId);await this.beforeAction?.(r,action);return {session:await this.paper.cycle(s.id)};}
    if(action==='mark')return {session:await this.paper.refresh(s.id)};
    throw new Error('Choose start, stop, cycle or mark.');
  }
  history(id:string){const r=this.read(id);this.verify(this.paper.store.read(r.sessionId));return this.paper.store.history(r.sessionId);}
  export(id:string){const r=this.read(id),a=this.agent(r.agentId),bundle=this.paper.store.export(r.sessionId);this.verify(bundle.session);this.verifyEvents(r,bundle.events);return {version:'PUMP-STRATEGY-EVIDENCE-v1',strategy:r,registration:{id:a.id,manifest:a.manifest,commitment:a.commitment},paper:bundle,boundary:'Local model decisions under a saved strategy. Paper accounting, not real fills or independently attested trading skill. Strategy text and inference prompts are included; review before sharing.'};}
  private verifyEvents(r:StrategyRun,events:Event[]){
    const a=this.agent(r.agentId);
    verifyStrategyDecisions(r,events,a.local.modelId,a.manifest.inference.runtime);
  }
}
