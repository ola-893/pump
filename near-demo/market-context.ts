import { freshQuote } from './ledger.js';
import { marketObservationSize, paperMarket, units, type Event, type Quote, type Session } from './types.js';

export type MarketContext = {
  version:'PUMPCOIN-QUOTE-CONTEXT-v1';
  source:Quote['source'];
  samples:{quoteId:string;observedAt:string;receivedAt:string;inputUSDC?:string;inputQuoteUnits?:string;outputWNEAR?:string;outputBaseUnits?:string}[];
  sampleCount:number;
  spanMs:number;
  outputChangeBps:number|null;
  scope:string;
};

/** Comparable, actually recorded quotes only; never invent candles or backfill prices. */
export function marketContext(s:Session,current:Quote,history:Event[]):MarketContext {
  const now=Date.parse(current.receivedAt);
  freshQuote(current,s,now);
  const {base,quote,symbol,quoteSymbol}=paperMarket(s.config);
  const custom=typeof s.config.market==='object';
  if(current.tokenIn!==quote||current.tokenOut!==base||current.amountIn!==marketObservationSize(s.config))throw new Error(custom?'Market context requires the saved per-order observation size.':'Market context requires the fixed one-USDC observation size.');
  const seen=new Set<string>();
  const quotes=[...history.flatMap(e=>e.sessionId===s.id&&(e.kind==='model'||e.kind==='blocked'&&e.evidence==='live-local-model')&&e.quote?[e.quote]:[]),current]
    .filter(q=>q.source===current.source&&q.tokenIn===current.tokenIn&&q.tokenOut===current.tokenOut&&q.amountIn===current.amountIn)
    .filter(q=>{const at=Date.parse(q.receivedAt);return Number.isFinite(at)&&at<=now&&now-at<=15*60*1000;})
    .sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt))
    .reverse()
    .filter(q=>{if(seen.has(q.id))return false;seen.add(q.id);return true;})
    .reverse()
    .slice(-20);
  for(const q of quotes)freshQuote(q,s,Date.parse(q.receivedAt));
  const samples:MarketContext["samples"]=quotes.map(q=>({quoteId:q.id,observedAt:q.observedAt,receivedAt:q.receivedAt,...(custom?{inputQuoteUnits:q.amountIn}:{inputUSDC:q.amountIn}),...(symbol==='wNEAR'?{outputWNEAR:q.amountOut}:{outputBaseUnits:q.amountOut})}));
  const first=samples[0],last=samples.at(-1)!;
  return {
    version:'PUMPCOIN-QUOTE-CONTEXT-v1',source:current.source,samples,sampleCount:samples.length,
    spanMs:Date.parse(last.receivedAt)-Date.parse(first.receivedAt),
    outputChangeBps:samples.length<2?null:Number((units(last.outputBaseUnits??last.outputWNEAR)-units(first.outputBaseUnits??first.outputWNEAR))*10000n/units(first.outputBaseUnits??first.outputWNEAR)),
    scope:custom?`Up to 20 recent signed observations at the saved per-order size. Each output is in ${symbol} base units for the same ${quoteSymbol} input. Rising output means cheaper base asset at that quote size.`:`Up to 20 recorded one-USDC dry-run route quotes from the last 15 minutes. Output change measures ${symbol} received per USDC, not a candle price, trading volume, news, or order-book depth. Synthetic observations remain synthetic. Sparse observations do not establish an edge.`
  };
}
