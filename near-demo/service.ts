import type { DemoStore } from './store.js';
import { makeEvent, initialPortfolio, fill, mark, metrics, digest, freshQuote, isPaperDust, retirePaperDust } from './ledger.js';
import { liveQuotes, scenarioQuotes, type QuoteProvider } from './quotes.js';
import { infer, parseProposal } from './model.js';
import { marketContext } from './market-context.js';
import { executionExercise, exerciseGuidance } from './exercise.js';
import { validateConfig, paperMarket, marketObservationSize, units, type Session, type Proposal, type Event, type Quote } from './types.js';

type PaperStore = Pick<DemoStore, 'list' | 'read' | 'create' | 'history' | 'lastQuotedValuation' | 'recent' | 'acquire' | 'renew' | 'release' | 'save' | 'export'>;
export class PaperDemo<Store extends PaperStore = DemoStore> {
  private timers=new Map<string,ReturnType<typeof setTimeout>>();
  private workers=new Map<string,symbol>();
  private lastErrors=new Map<string,string>();
  private closing=false;
  private cycleTail:Promise<unknown>=Promise.resolve();
  private pending=new Set<string>();
  private activeId:string|null=null;
  private marks?:ReturnType<typeof setInterval>;
  get execution(){return {activeId:this.activeId,queued:[...this.pending].filter(id=>id!==this.activeId)};}
  get busy(){return this.pending.size>0;}
  readonly store:Store;
  private options:{quotes?:(s:Session)=>QuoteProvider;infer?:typeof infer;now?:()=>number;delay?:(ms:number)=>Promise<void>};
  constructor(store:Store,options:{quotes?:(s:Session)=>QuoteProvider;infer?:typeof infer;now?:()=>number;delay?:(ms:number)=>Promise<void>}={}){this.store=store;this.options=options;}
  private strategyGuard?: (id:string)=>void;
  setStrategyGuard(guard:(id:string)=>void){this.strategyGuard=guard;}
  private checkStrategy(s:Session){if(s.agent?.strategyRunId)this.strategyGuard?.(s.agent.strategyRunId);}
  setInferenceProvider(provider:typeof infer){this.options.infer=provider;}
  private now(){return this.options.now?.()??Date.now();}
  private quotes(s:Session){return this.options.quotes?.(s)??(s.config.source==='live'?liveQuotes(fetch,()=>this.now(),s.config.market):scenarioQuotes());}
  list(){return this.store.list().map(s=>this.view(s));}
  view(s:Session){
    // A scheduler lease is process-local. Restart never silently resumes a trading loop.
    const stale=units(s.portfolio.position)>0n&&(!s.portfolio.markAt||this.now()-Date.parse(s.portfolio.markAt)>s.config.maxQuoteAgeMs);
    const shown=stale?{...s,portfolio:{...s.portfolio,equity:null,drawdownBps:null}}:s;
    const prior=stale?this.store.lastQuotedValuation(s.id):undefined;
    const quoted=s.portfolio.equity!==null&&s.portfolio.markAt?s.portfolio:prior?.after;
    // Retained values are display-only. Current equity and trading guards still expire normally.
    const lastValuation=stale&&quoted?.equity!=null&&quoted.markAt?{equity:quoted.equity,at:quoted.markAt,realized:quoted.realized,sequence:prior?.sequence??s.sequence}:null;
    return {...shown,lastValuation,valuationStale:stale,state:this.timers.has(s.id)?'running':'stopped',metrics:metrics(shown),error:this.lastErrors.get(s.id)??null,capabilities:{mainnetTrading:false,quotesOnly:true}};
  }
  create(config:unknown,id:string=crypto.randomUUID()){const c=validateConfig(config),s:Session={id,version:1,createdAt:new Date(this.now()).toISOString(),config:c,portfolio:initialPortfolio(c.initialCash),revision:0,sequence:0,head:null,state:'stopped',turnover:{day:'',used:'0'}};this.store.create(s);return this.view(s);}
  checkExercise(id:string){const s=this.store.read(id);if(this.pending.has(id)||this.timers.has(id))throw new Error('Stop the worker and wait for its active decision first.');if(s.agent?.strategyRunId)throw new Error('Strategy portfolios do not accept forced execution exercises.');if(s.testnet||units(s.portfolio.position)>0n||units(s.portfolio.cash)<2000000n||units(s.config.tradeCap)<2000000n||units(s.config.exposureCap)<2000000n)throw new Error('The exercise requires an unfunded paper session with no position and room for a 2 USDC test.');if(s.exercise&&exerciseGuidance(s,this.store.history(id))?.phase!=='COMPLETE')throw new Error('Complete the active execution exercise before requesting another.');return s;}
  async requestExercise(id:string){return this.locked(id,async token=>{const s=this.checkExercise(id),exercise=executionExercise(crypto.randomUUID(),new Date(this.now()).toISOString());const next=this.record({...s,exercise},token,{kind:'mandate',evidence:'operator-mandate',exercise,reason:exercise.disclosure+' '+exercise.objective,after:s.portfolio});return this.view(next);});}
  private async locked<T>(id:string,run:(token:string)=>Promise<T>){const token=this.store.acquire(id);const heartbeat=setInterval(()=>{try{this.store.renew(id,token);}catch{clearInterval(heartbeat);}},30000);if(typeof heartbeat==='object')heartbeat.unref();try{return await run(token);}finally{clearInterval(heartbeat);this.store.release(id,token);}}
  private record(s:Session,token:string,detail:Omit<Event,'id'|'sessionId'|'sequence'|'previousHash'|'before'|'hash'|'at'>){const at=(detail.kind==='mark'||detail.kind==='dust')&&detail.after.markAt?detail.after.markAt:new Date(this.now()).toISOString();const e=makeEvent(s,{...detail,at});return this.store.save(s,token,e);}
  private clearPaperDust(s:Session,token:string){
    if(units(s.portfolio.position)===0n||units(s.portfolio.position)>10n**18n||units(s.portfolio.cost)>10n||!s.agent?.strategyRunId||s.testnet)return s;
    const sale=this.store.history(s.id).filter(e=>e.kind==='fill').at(-1);
    if(!isPaperDust(s,sale))return s;
    return this.record(s,token,{kind:'dust',evidence:'paper-adjustment',dust:{policy:'PUMP-PAPER-DUST-v1',saleHash:sale!.hash},reason:`Paper rounding residual retired: ${s.portfolio.position} base units of ${paperMarket(s.config).symbol}; remaining cost ${s.portfolio.cost} quote base units charged as a loss. No sale, proceeds or trading volume assumed.`,after:retirePaperDust(s,sale,this.now())});
  }
  async refresh(id:string){return this.locked(id,async token=>{
    let s=this.store.read(id);
    if(s.testnet?.settlementPrepared)throw new Error('Session is sealed for settlement.');
    s=this.clearPaperDust(s,token);
    try {const q=units(s.portfolio.position)>0n?await this.quotes(s).get(paperMarket(s.config).base,paperMarket(s.config).quote,s.portfolio.position,s.config.slippageBps):undefined;s=this.record(s,token,{kind:'mark',evidence:'quote-mark',reason:'Fresh quoted liquidation value; hypothetical fills and returns.',quote:q,after:mark(s,q,this.now())});this.lastErrors.delete(id);}
    catch{ s=this.record(s,token,{kind:'mark',evidence:'quote-mark',reason:'Liquidation quote unavailable; current equity is unavailable.',after:mark(s,undefined,this.now())});this.lastErrors.set(id,'Could not obtain a fresh liquidation quote.'); }
    return this.view(s);
  });}
  // Explicit owner intervention: never a model decision, never an entry, and
  // bound to the exact inventory and last fill so a retry cannot sell a new lot.
  async operatorExit(id:string,expectedPosition:string,lastFillHash:string){
    if(this.pending.has(id)||this.timers.has(id))throw new Error('Stop the worker and wait for its active decision before an operator exit.');
    return this.locked(id,async token=>{
      let s=this.store.read(id);this.checkStrategy(s);
      if(!s.agent?.strategyRunId||s.exercise||s.testnet)throw new Error('Operator exit requires an independent paper strategy portfolio.');
      if(this.closing)throw new Error('Paper strategy is unavailable.');
      const last=this.store.history(id).filter(e=>e.kind==='fill').at(-1);
      if(units(expectedPosition,false)!==units(s.portfolio.position)||!last||last.hash!==lastFillHash)throw new Error('The requested position changed; inspect it before retrying the operator exit.');
      const operatorExit={expectedPosition,lastFillHash};
      const reason='Owner-requested one-time paper SELL; operator intervention, not a model decision. Saved strategy unchanged.';
      try{
        const q=await this.quotes(s).get(paperMarket(s.config).base,paperMarket(s.config).quote,s.portfolio.position,s.config.slippageBps);
        if(this.closing)throw new Error('Demo service is stopping.');
        if(q.amountIn!==s.portfolio.position)throw new Error('Operator exit must quote the exact whole position.');
        const day=new Date(this.now()).toISOString().slice(0,10),used=s.turnover.day===day?units(s.turnover.used):0n;
        if(used+units(q.amountOut)>units(s.config.dailyTurnoverCap))throw new Error('UTC daily gross turnover cap reached.');
        const after=fill(s,'SELL',q,this.now());
        s=this.record({...s,turnover:{day,used:String(used+units(q.amountOut))}},token,{kind:'fill',action:'SELL',evidence:'operator-exit',operatorExit,reason,quote:q,after});
        s=this.record(s,token,{kind:'mark',evidence:'quote-mark',reason:'Paper portfolio marked after owner-requested exit.',after:mark(s,undefined,this.now())});
        this.lastErrors.delete(id);return this.view(s);
      }catch(error){
        const message=error instanceof Error&&error.message.length<250?error.message:'Operator exit failed; no fill assumed.';
        this.lastErrors.set(id,message);
        s=this.record(s,token,{kind:'blocked',evidence:'operator-exit',operatorExit,reason:message,after:s.portfolio});
        return this.view(s);
      }
    });
  }
  cycle(id:string,manual?:Proposal){return this.enqueue(id,manual);}
  private async enqueue(id:string,manual?:Proposal,enabled=()=>true){
    if(this.pending.has(id))throw new Error('Another cycle owns this session; wait for it to finish.');
    this.checkStrategy(this.store.read(id));this.pending.add(id);
    // Queue before acquiring a ledger lease or market quote. A model waiting for
    // another model to unload must not consume its lease or use an old input.
    const next=this.cycleTail.then(async()=>{
      if(this.closing||!enabled())return this.view(this.store.read(id));
      this.activeId=id;
      try{return await this.runCycle(id,manual);}finally{this.activeId=null;}
    });
    this.cycleTail=next.catch(()=>{});
    try{return await next;}finally{this.pending.delete(id);}
  }
  private async runCycle(id:string,manual?:Proposal){return this.locked(id,async token=>{
    let s=this.store.read(id);if(manual&&s.agent?.strategyRunId)throw new Error('Manual scenarios are disabled for strategy portfolios.');const guidance=manual?undefined:exerciseGuidance(s,this.store.history(id)),directed=guidance&&guidance.phase!=='COMPLETE';
    const evidence=manual?'manual-scenario' as const:directed?'operator-directed-model' as const:'live-local-model' as const;
    const exerciseTag=directed?{exerciseId:guidance.id}:{};
    if(s.testnet?.settlementPrepared)throw new Error('Session is sealed for settlement.');
    s=this.clearPaperDust(s,token);
    let market:Quote|undefined;
    try {
      if(this.closing)throw new Error('Demo service is stopping.');
      let model:Awaited<ReturnType<typeof infer>>|undefined;
      let proposal:Proposal;
      if(manual){if(s.agent?.strategyRunId)throw new Error('Manual scenarios are disabled for strategy portfolios.');proposal=parseProposal(manual);}
      else {
        market=await this.quotes(s).get(paperMarket(s.config).quote,paperMarket(s.config).base,marketObservationSize(s.config),s.config.slippageBps);
        const context=marketContext(s,market,this.store.recent(id));
        const response=await (this.options.infer??infer)(s,market,undefined,context);
        const {market:refreshed,...evidence}=response;
        if(refreshed){
          const received=Date.parse(refreshed.receivedAt);
          if(!Number.isFinite(received)||received<Date.parse(market.receivedAt)||received>this.now())throw new Error('Replacement market quote is stale or has an invalid receipt time.');
          // This is a recorded inference input, not an execution quote. The fill obtains a new quote below.
          freshQuote(refreshed,s,received);market=refreshed;
        }
        model=evidence;
        proposal=model.proposal;
      }
      s=this.record(s,token,{kind:'model',evidence,...exerciseTag,reason:proposal.reason,model,quote:market,after:s.portfolio});
      if(proposal.action==='HOLD'){
        s=this.record(s,token,{kind:'hold',evidence,...exerciseTag,reason:proposal.reason,after:s.portfolio});
        if(units(s.portfolio.position)>0n){
          try{const exit=await this.quotes(s).get(paperMarket(s.config).base,paperMarket(s.config).quote,s.portfolio.position,s.config.slippageBps);s=this.record(s,token,{kind:'mark',evidence:'quote-mark',reason:'Fresh whole-position exit quote after model HOLD.',quote:exit,after:mark(s,exit,this.now())});}
          catch{s=this.record(s,token,{kind:'mark',evidence:'quote-mark',reason:'HOLD recorded; current exit valuation unavailable.',after:mark(s,undefined,this.now())});}
        }
        this.lastErrors.delete(id);return this.view(s);
      }
      const budget=units(proposal.quoteUnits,false);
      if(directed&&(proposal.action!==guidance.phase||proposal.action==='BUY'&&budget>units(guidance.buyQuoteUnits)))throw new Error('Proposal exceeds the operator-directed exercise phase or 2 USDC buy limit.');
      if(manual&&s.exercise&&exerciseGuidance(s,this.store.history(id))?.phase!=='COMPLETE')throw new Error('Manual orders cannot execute an active model exercise.');
      if(budget>units(s.config.tradeCap))throw new Error('Proposal exceeds the per-trade cap.');
      if(proposal.action==='BUY'&&(budget>units(s.portfolio.cash)||units(s.portfolio.cost)+budget>units(s.config.exposureCap)))throw new Error('Proposal exceeds cash or allocated-cost exposure.');
      await (this.options.delay??(ms=>new Promise(r=>setTimeout(r,ms))))(s.config.executionDelayMs);
      if(this.closing)throw new Error('Demo service is stopping.');
      let amount=budget.toString(),wholeExit:Quote|undefined;
      if(proposal.action==='SELL'){
        if(units(s.portfolio.position)===0n)throw new Error('No paper position to sell.');
        const exit=await this.quotes(s).get(paperMarket(s.config).base,paperMarket(s.config).quote,s.portfolio.position,s.config.slippageBps);
        if(budget>=units(exit.amountOut)){amount=s.portfolio.position;wholeExit=exit;}
        else amount=String(units(s.portfolio.position)*budget/units(exit.amountOut));
      }
      const {base,quote}=paperMarket(s.config);
      const q=wholeExit??await this.quotes(s).get(proposal.action==='BUY'?quote:base,proposal.action==='BUY'?base:quote,amount,s.config.slippageBps);
      if(this.closing)throw new Error('Demo service is stopping.');
      const notional=proposal.action==='BUY'?units(q.amountIn):units(q.amountOut),day=new Date(this.now()).toISOString().slice(0,10),used=s.turnover.day===day?units(s.turnover.used):0n;
      if(used+notional>units(s.config.dailyTurnoverCap))throw new Error('UTC daily gross turnover cap reached.');
      const after=fill(s,proposal.action,q,this.now());
      s=this.record({...s,turnover:{day,used:String(used+notional)}},token,{kind:'fill',evidence,...exerciseTag,action:proposal.action,reason:proposal.reason,quote:q,after});
      s=this.clearPaperDust(s,token);
      try {const exit=units(s.portfolio.position)>0n?await this.quotes(s).get(paperMarket(s.config).base,paperMarket(s.config).quote,s.portfolio.position,s.config.slippageBps):undefined;s=this.record(s,token,{kind:'mark',evidence:'quote-mark',reason:'Portfolio marked with whole-position exit quote.',quote:exit,after:mark(s,exit,this.now())});}
      catch {s=this.record(s,token,{kind:'mark',evidence:'quote-mark',reason:'Fill recorded; current exit valuation unavailable.',after:mark(s,undefined,this.now())});}
      if(directed&&exerciseGuidance(s,this.store.history(id))?.phase==='COMPLETE')this.stop(id);
      this.lastErrors.delete(id);return this.view(s);
    } catch(error){
      const reason=error instanceof Error && error.message.length<250 ? error.message:'Paper cycle failed; no additional fill assumed.';
      this.lastErrors.set(id,reason);s=this.record(s,token,{kind:'blocked',evidence,...exerciseTag,reason,quote:market,after:s.portfolio});return this.view(s);
    }
  });}
  start(id:string){if(this.timers.has(id))return this.view(this.store.read(id));const s=this.store.read(id);this.checkStrategy(s);if(s.testnet?.settlementPrepared)throw new Error('Session is sealed for settlement.');
    const worker=Symbol(id);this.workers.set(id,worker);
    const enabled=()=>this.workers.get(id)===worker&&!this.closing;
    const tick=async()=>{try{await this.enqueue(id,undefined,enabled);}catch{this.lastErrors.set(id,'Cycle locked or storage unavailable.');}if(enabled())this.timers.set(id,setTimeout(()=>void tick(),s.config.intervalMs));};
    if(!this.marks){this.marks=setInterval(()=>{for(const current of this.store.list())if(this.timers.has(current.id)&&!this.pending.has(current.id)&&units(current.portfolio.position)>0n&&!current.testnet?.settlementPrepared)void this.refresh(current.id).catch(()=>{});},20000);if(typeof this.marks==='object')this.marks.unref();}
    this.timers.set(id,setTimeout(()=>void tick(),0));return this.view(s);
  }
  stop(id:string){clearTimeout(this.timers.get(id));this.timers.delete(id);this.workers.delete(id);if(!this.timers.size){clearInterval(this.marks);this.marks=undefined;}return this.view(this.store.read(id));}
  async attach(id:string,account:string,claim:{claim:string;session_id:string;pending:unknown;deposited:string}){return this.locked(id,async token=>{
    let s=this.store.read(id);if(s.agent?.strategyRunId)throw new Error('Strategy portfolios use virtual capital only.');if(s.sequence!==0||s.testnet||claim.session_id!==s.id||claim.pending||claim.claim!==claim.deposited)throw new Error('Link a fresh session to an unmodified confirmed deposit before any trading.');
    units(claim.claim,false);s={...s,config:{...s.config,initialCash:claim.claim},portfolio:initialPortfolio(claim.claim),testnet:{account,initialClaim:claim.claim}};this.store.save(s,token);return this.view(this.store.read(id));
  });}
  async result(id:string){return this.locked(id,async token=>{let s=this.store.read(id);
    const bundle=this.store.export(id);
    if(this.timers.has(id)||units(s.portfolio.position)!==0n||!s.testnet||!s.head)throw new Error('Stop the agent and close its paper position before preparing a testnet result.');
    if(!s.testnet.settlementPrepared){s={...s,testnet:{...s.testnet,settlementPrepared:true}};this.store.save(s,token);}
    return {account_id:s.testnet!.account,session_id:s.id,expected_claim:s.testnet!.initialClaim,new_claim:s.portfolio.cash,sequence:s.sequence,evidence_hash:digest({...bundle,session:this.store.read(id)})};
  });}
  close(){this.closing=true;for(const id of this.timers.keys())this.stop(id);}
}
