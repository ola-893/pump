import { createHash } from 'node:crypto';
import { verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
import { paperMarket, units, type Config, type Portfolio, type Quote, type Session, type Event } from './types.js';
import { executionExercise, type ExecutionExercise } from './exercise.js';
export function canonical(v: unknown): string {
  if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isSafeInteger(v))) return JSON.stringify(v);
  if (Array.isArray(v)) return '['+v.map(canonical).join(',')+']';
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return '{'+Object.keys(v).sort().filter(k => (v as any)[k] !== undefined).map(k => JSON.stringify(k)+':'+canonical((v as any)[k])).join(',')+'}';
  throw new Error('Unsupported evidence encoding.');
}
export const digest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
export function initialPortfolio(cash: string): Portfolio { units(cash,false); return { cash, position:'0', cost:'0', realized:'0', equity:cash, peak:cash, drawdownBps:0, maxDrawdownBps:0, markAt:null }; }
export function freshQuote(q: Quote, s: {config:Pick<Config,'source'|'maxQuoteAgeMs'>}, now: number) {
  const age = now - Date.parse(q.receivedAt), sourceAge = now - Date.parse(q.observedAt);
  if (q.source !== s.config.source || !Number.isFinite(age) || age < 0 || age > s.config.maxQuoteAgeMs || !Number.isFinite(sourceAge) || sourceAge < -5000 || sourceAge > s.config.maxQuoteAgeMs) throw new Error('Quote is stale or belongs to a different source.');
  units(q.amountIn,false); units(q.amountOut,false); if (units(q.minimumOut) > units(q.amountOut)) throw new Error('Invalid minimum output.');
  if (q.source === 'live') {
    const raw=q.raw as any;
    if(!q.signatureVerified||!verifyQuoteSignature(raw)||q.id!==digest(raw)||raw.timestamp!==q.observedAt||raw.quoteRequest?.dry!==true||raw.quoteRequest.originAsset!==q.tokenIn||raw.quoteRequest.destinationAsset!==q.tokenOut||raw.quoteRequest.amount!==q.amountIn||raw.quote?.amountOut!==q.amountOut||raw.quote?.minAmountOut!==q.minimumOut)throw new Error('Quote signature or signed amount binding is invalid.');
  }
}
export function fill(s: Session, side: 'BUY' | 'SELL', q: Quote, now: number): Portfolio {
  freshQuote(q,s,now);
  const p = s.portfolio, input = units(q.amountIn,false), output = units(q.amountOut,false);
  const cash = units(p.cash), pos = units(p.position), cost = units(p.cost);
  const {base,quote}=paperMarket(s.config);
  if (side === 'BUY') {
    if (q.tokenIn !== quote || q.tokenOut !== base || input > cash || input > units(s.config.tradeCap) || cost + input > units(s.config.exposureCap)) throw new Error('Buy exceeds cash, trade or allocated-cost exposure limits.');
    return { ...p, cash:String(cash-input), position:String(pos+output), cost:String(cost+input), equity:null, markAt:null, drawdownBps:null };
  }
  if (q.tokenIn !== base || q.tokenOut !== quote || input > pos || pos === 0n || output > units(s.config.tradeCap)) throw new Error('Sell exceeds inventory or quote-proceeds trade cap.');
  const allocated = input === pos ? cost : cost * input / pos;
  return { ...p, cash:String(cash+output), position:String(pos-input), cost:String(cost-allocated), realized:String(BigInt(p.realized)+output-allocated), equity:null, markAt:null, drawdownBps:null };
}
export function mark(s: Session, q: Quote | undefined, now: number): Portfolio {
  const p = s.portfolio; let equity = units(p.cash);
  if (units(p.position) > 0n) {
    if (!q) return { ...p, equity:null, markAt:null, drawdownBps:null };
    freshQuote(q,s,now);
    const {base,quote}=paperMarket(s.config);
    if (q.tokenIn !== base || q.tokenOut !== quote || q.amountIn !== p.position) throw new Error('Mark must quote liquidation of the exact whole position.');
    equity += units(q.amountOut);
  }
  const peak = equity > units(p.peak) ? equity : units(p.peak), dd = peak === 0n ? 0 : Number((peak-equity)*10000n/peak);
  return { ...p, equity:String(equity), peak:String(peak), drawdownBps:dd, maxDrawdownBps:Math.max(dd,p.maxDrawdownBps), markAt:new Date(now).toISOString() };
}
// Paper-only retirement of a rounding residual, never an exchange fill or cash credit.
// Both its quantity and its last-sale implied value must be negligible. Its full
// remaining purchase cost is charged as a loss and the original units stay in history.
export function isPaperDust(s:Session,sale:Event|undefined):boolean {
  if(typeof s.config.market==='object')return false;
  const p=s.portfolio,pos=units(p.position),cost=units(p.cost),{base,quote,decimals}=paperMarket(s.config);
  if(!s.agent?.strategyRunId||s.testnet||s.exercise||!sale||sale.kind!=='fill'||sale.action!=='SELL'||sale.evidence!=='live-local-model'||sale.sessionId!==s.id||!sale.quote||pos===0n||pos>10n**BigInt(Math.max(0,decimals-6))||cost>10n)return false;
  if(['position','cost','cash','realized'].some(k=>(sale.after as any)[k]!== (p as any)[k]))return false;
  if(pos>=units(sale.before.position)||units(sale.quote.amountIn)===0n)return false;
  freshQuote(sale.quote,s,Date.parse(sale.at));
  if(sale.quote.tokenIn!==base||sale.quote.tokenOut!==quote)return false;
  const input=units(sale.quote.amountIn),implied=(units(sale.quote.amountOut)*pos+input-1n)/input;
  return implied<=10n;
}
export function retirePaperDust(s:Session,sale:Event|undefined,now:number):Portfolio {
  if(!isPaperDust(s,sale))throw new Error('Position is not an eligible paper rounding residual.');
  const p=s.portfolio;
  return mark({...s,portfolio:{...p,position:'0',cost:'0',realized:String(BigInt(p.realized)-units(p.cost))}},undefined,now);
}
export function metrics(s: Session) {
  const p = s.portfolio, total = p.equity === null ? null : BigInt(p.equity)-units(s.config.initialCash);
  return { total:total?.toString() ?? null, realized:p.realized, unrealized:total === null ? null : String(total-BigInt(p.realized)), returnBps:total === null ? null : Number(total*10000n/units(s.config.initialCash)), costModel:'Quoted output includes route economics; network gas and setup costs excluded.', exposurePolicy:'Allocated purchase cost; not a continuous marked-exposure guarantee.' };
}
export function makeEvent(s: Session, detail: Omit<Event,'id'|'sessionId'|'sequence'|'previousHash'|'before'|'hash'>): Event {
  const body = { id:`${s.id}:${s.sequence+1}`, sessionId:s.id, sequence:s.sequence+1, previousHash:s.head, before:s.portfolio, ...detail };
  return { ...body, hash:digest(body) };
}
export function verifyHistory(s: Session, events: Event[]) {
  let lastFill:Event|undefined;
  let directive:ExecutionExercise|undefined,exerciseBought=false,exerciseComplete=false;const exerciseIds=new Set<string>();
  let p = initialPortfolio(s.config.initialCash), head: string | null = null, sequence=0,previousTime=Date.parse(s.createdAt);const turnover=new Map<string,bigint>();
  for (const e of events) {
    const {hash,...body}=e;
    if (hash !== digest(body) || e.sessionId !== s.id || e.sequence !== ++sequence || e.previousHash !== head || canonical(e.before)!==canonical(p)) throw new Error('Paper history is inconsistent.');
    if(!Number.isFinite(Date.parse(e.at))||Date.parse(e.at)<previousTime)throw new Error('Paper event time moved backward.');previousTime=Date.parse(e.at);
    if(e.evidence==='operator-exit'){
      if(!s.agent?.strategyRunId||s.exercise||s.testnet||!['fill','blocked'].includes(e.kind)||!e.operatorExit||e.operatorExit.expectedPosition!==p.position||!lastFill||e.operatorExit.lastFillHash!==lastFill.hash||e.model||e.exercise||e.exerciseId||e.kind==='fill'&&(e.action!=='SELL'||e.quote?.amountIn!==p.position))throw new Error('Invalid or stale operator exit receipt.');
    }else if(e.operatorExit)throw new Error('Operator exit receipt on an unrelated event.');
    let expected = p;
    if(e.kind==='mandate'){
      if(directive&&!exerciseComplete||!e.exercise||exerciseIds.has(e.exercise.id)||units(p.position)>0n||e.evidence!=='operator-mandate'||canonical(e.exercise)!==canonical(executionExercise(e.exercise.id,e.exercise.startedAt))||Date.parse(e.exercise.startedAt)>Date.parse(e.at))throw new Error('Invalid or duplicate execution mandate.');
      directive=e.exercise;exerciseIds.add(directive.id);exerciseBought=false;exerciseComplete=false;
    }
    if(e.evidence==='operator-directed-model'||e.exerciseId){
      if(!directive||e.exerciseId!==directive.id||e.evidence!=='operator-directed-model')throw new Error('Directed event has no matching recorded mandate.');
      if(e.kind==='fill'){
        if(exerciseComplete||e.action!==(exerciseBought?'SELL':'BUY')||e.action==='BUY'&&units(e.quote!.amountIn)>units(directive.buyQuoteUnits))throw new Error('Exercise fill violates its recorded phase or buy cap.');
        if(e.action==='BUY')exerciseBought=true;else if(e.after.position==='0')exerciseComplete=true;
      }
    }
    if(e.kind==='fill'&&directive&&!exerciseComplete&&e.evidence!=='operator-directed-model')throw new Error('Undirected fill inside an active execution exercise.');
    const prior = { ...s, portfolio:p };
    if (e.kind==='fill') { if(!e.quote||!e.action) throw new Error('Missing fill quote.');expected=fill(prior,e.action,e.quote,Date.parse(e.at));const day=e.at.slice(0,10),n=(turnover.get(day)??0n)+units(e.action==='BUY'?e.quote.amountIn:e.quote.amountOut);if(n>units(s.config.dailyTurnoverCap))throw new Error('Replayed turnover exceeds policy.');turnover.set(day,n); }
    if(e.dust&&e.kind!=='dust')throw new Error('Dust receipt on an unrelated event.');
    if(e.kind==='dust'){
      if(e.evidence!=='paper-adjustment'||e.action||e.quote||e.model||e.exercise||e.exerciseId||!lastFill||canonical(e.dust)!==canonical({policy:'PUMP-PAPER-DUST-v1',saleHash:lastFill.hash}))throw new Error('Invalid paper dust receipt.');
      expected=retirePaperDust(prior,lastFill,Date.parse(e.at));
    }
    if (e.kind==='mark') {
      // Earlier journals stamped the valuation just before stamping the event.
      // Replay that recorded valuation time without changing historical hashes.
      const valuedAt=e.after.markAt===null?Date.parse(e.at):Date.parse(e.after.markAt);
      if(!Number.isFinite(valuedAt)||valuedAt>Date.parse(e.at)||Date.parse(e.at)-valuedAt>1000)throw new Error('Valuation time differs from its journal event.');
      expected=mark(prior,e.quote,valuedAt);
    }
    if (canonical(expected)!==canonical(e.after)) throw new Error('Paper balances differ from replay.');
    if(e.kind==='fill')lastFill=e;
    p=e.after;head=hash;
  }
  if (head!==s.head||sequence!==s.sequence||canonical(p)!==canonical(s.portfolio)) throw new Error('Paper checkpoint differs from journal.');
  if(canonical(directive??null)!==canonical(s.exercise??null))throw new Error('Execution mandate checkpoint differs from journal.');
  const lastDay=[...turnover.keys()].sort().at(-1)??'';
  if(s.turnover.day!==lastDay||s.turnover.used!==String(turnover.get(lastDay)??0n))throw new Error('Turnover checkpoint differs from journal.');
  return {events:sequence,head,portfolio:p,scope:'Local consistency and accounting replay; no exchange fill or model-host attestation.'};
}
