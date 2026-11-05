import { digest } from './ledger.js';
export type Candle={openAt:number;closeAt:number;open:string;high:string;low:string;close:string;volume:string;trades:number};
export type MarketDataset={version:'PUMPCOIN-NEAR-MARKET-v1';id:string;source:'Binance public spot';symbol:'NEARUSDT'|'ETHUSDC';interval:'1h';capturedAt:string;url:string;bars:Candle[];scope:string};
export function parseCandles(raw:unknown,now:number):Candle[]{
  if(!Array.isArray(raw)||raw.length>1000)throw new Error('Invalid market-history response.');
  const bars:Candle[]=[];
  for(const r of raw){if(!Array.isArray(r)||r.length<9)throw new Error('Malformed market candle.');const [openAt,o,h,l,c,v,closeAt,,trades]=r;
    if(!Number.isSafeInteger(openAt)||!Number.isSafeInteger(closeAt)||closeAt!==openAt+3599999||openAt%3600000!==0||!Number.isSafeInteger(trades)||trades<0)throw new Error('Invalid candle timing or trade count.');
    if([o,h,l,c,v].some(x=>typeof x!=='string'||!/^\d+(?:\.\d{1,18})?$/.test(x)||!Number.isFinite(Number(x)))||Math.min(+o,+h,+l,+c)<=0||+v<0||+l>Math.min(+o,+c)||+h<Math.max(+o,+c)||+h<+l)throw new Error('Invalid candle prices.');
    if(closeAt>=now)continue; // Never give an agent an unfinished bar.
    if(bars.length&&openAt!==bars.at(-1)!.openAt+3600000)throw new Error('Market history has gaps or duplicates.');
    bars.push({openAt,closeAt,open:o,high:h,low:l,close:c,volume:v,trades});
  }return bars;
}
export async function fetchMarketHistory(fetcher=fetch,now=Date.now(),symbol:MarketDataset['symbol']='NEARUSDT'):Promise<MarketDataset>{
  const url=`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&limit=721`;
  const response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error(`Public market history unavailable (HTTP ${response.status}). No synthetic fallback.`);
  const text=await response.text();if(text.length>1024*1024)throw new Error('Market history response too large.');
  const bars=parseCandles(JSON.parse(text),now).slice(-720);if(bars.length<600||now-bars.at(-1)!.closeAt>2*3600000)throw new Error('Need at least 600 recent closed hourly candles.');
  const body={version:'PUMPCOIN-NEAR-MARKET-v1' as const,source:'Binance public spot' as const,symbol,interval:'1h' as const,capturedAt:new Date(now).toISOString(),url,bars,scope:symbol==='ETHUSDC'?'Public ETH/USDC exchange candles for research. These are separate from 1Click execution quotes.':'Public NEAR/USDT exchange candles for research. USDT is not USDC. These are not NEAR Intents execution quotes. Historical fills use an explicitly separate USDT simulation; no tokens move.'};
  return {...body,id:digest(body)};
}
export function researchWindow(data:MarketDataset,through=data.bars.length-1){
  if(!Number.isSafeInteger(through)||through<0||through>=data.bars.length)throw new Error('Invalid research cutoff.');
  const past=data.bars.slice(0,through+1),bars=past.slice(-24),last=bars.at(-1)!;
  const days=new Map<number,Candle[]>();for(const b of past){const day=Math.floor(b.openAt/86400000)*86400000;days.set(day,[...(days.get(day)??[]),b]);}
  const daily=[...days.entries()].filter(([,v])=>v.length===24).slice(-30).map(([day,v])=>[day,Number(v[0].open),Math.max(...v.map(b=>Number(b.high))),Math.min(...v.map(b=>Number(b.low))),Number(v.at(-1)!.close),Math.round(v.reduce((sum,b)=>sum+Number(b.volume),0))]);
  const asset=data.symbol==='ETHUSDC'?'ETH':'NEAR';
  return {datasetId:data.id,source:data.source,symbol:data.symbol,through:new Date(last.closeAt).toISOString(),availableClosedHourlyBars:past.length,columns:['openTimeUTCms','open','high','low','close',`${asset}volume`,'trades'],hourly:bars.map(b=>[b.openAt,Number(b.open),Number(b.high),Number(b.low),Number(b.close),Math.round(Number(b.volume)),b.trades]),dailyColumns:['openTimeUTCms','open','high','low','close',`${asset}volume`],daily,scope:data.scope+` Input volume is rounded to whole ${asset}. Only complete UTC days and candles through the decision cutoff are supplied.`};
}
