import type {AgentPerformance} from './agent-performance.js';
export type CommonPeriodInput={id:string;name:string;report:AgentPerformance};
export function commonPeriod(inputs:CommonPeriodInput[],extraCostPerFill='0'){
 if(inputs.length<2)throw new Error('Choose at least two strategy records.');
 if(!/^\d+$/.test(extraCostPerFill))throw new Error('Cost must be nonnegative micro-USDC.');
 const series=inputs.map(x=>x.report.observations.map(p=>({...p,time:Date.parse(p.at)})).filter(p=>Number.isFinite(p.time)).sort((a,b)=>a.time-b.time||a.sequence-b.sequence));
 const start=Math.max(...inputs.map(x=>Date.parse(x.report.firstDecision??x.report.createdAt)));
 const end=Math.min(...series.map(points=>points.filter(p=>p.equity!==null).at(-1)?.time??-Infinity));
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return {start:null,end:null,rows:[],eligible:false,reason:'No overlapping observed trading period yet.'};
 const cost=BigInt(extraCostPerFill);
 if(cost>0n&&inputs.some(({report})=>report.quoteCurrency&&(report.quoteCurrency.symbol!=='USDC'||report.quoteCurrency.decimals!==6)))
   throw new Error('A USDC cost can only be applied to USDC-quoted portfolios.');
 const rows=inputs.map((input,i)=>{
  const points=series[i],first=points.filter(p=>p.time<=start&&p.equity!==null).at(-1),last=points.filter(p=>p.time<=end&&p.equity!==null).at(-1);
  const fills=input.report.activity.filter(e=>e.kind==='fill'&&Date.parse(e.at)>start&&Date.parse(e.at)<=end);
  const signedFills=fills.filter(f=>f.quote?.signed&&f.quote.source==='live').length;
  const closed=input.report.closed.filter(p=>Date.parse(p.openedAt)>=start&&Date.parse(p.closedAt)<=end);
  let reason=!first||!last?'Boundary valuations unavailable.':start-first.time>60000||end-last.time>60000?'Boundary valuation is over 60 seconds from the shared period.':null;
  const observed=first&&last?[first,...points.filter(p=>p.time>start&&p.time<=end)]:[];
  if(observed.some((p,j)=>p.equity===null||j>0&&p.time-observed[j-1].time>180000))reason='Valuation gaps prevent a continuous risk comparison.';
  const initial=BigInt(first?.equity??'0'),ending=BigInt(last?.equity??'0')-BigInt(fills.length)*cost;
  if(signedFills!==fills.length)reason='Every fill needs a verified live quote for performance comparison.';
  if(initial<=0n)reason='Starting equity is unavailable or nonpositive.';
  let peak=initial,drawdownBps=0n;
  for(const p of observed){if(p.equity===null)continue;const incurred=BigInt(fills.filter(f=>Date.parse(f.at)<=p.time).length)*cost,equity=BigInt(p.equity)-incurred;if(equity>peak)peak=equity;if(peak>0n){const dd=(peak-equity)*1000000n/peak;if(dd>drawdownBps)drawdownBps=dd;}}
  if(end-start<600000&&!reason)reason='Less than 10 minutes of overlapping observations.';
  if((fills.length<2||closed.length<2)&&!reason)reason='Fewer than two fills and two fully observed closed positions in this period.';
  if(input.report.operatorExits||input.report.activity.some(e=>e.operatorDirected))reason='Owner-directed exit affected this portfolio; excluded from autonomous performance comparison.';
  return {id:input.id,name:input.name,from:first?.at??null,through:last?.at??null,startingEquity:first?.equity??null,endingEquity:last?.equity??null,
   extraCosts:String(BigInt(fills.length)*cost),adjustedPnl:initial>0n?String(ending-initial):null,returnPct:initial>0n?Number((ending-initial)*1000000n/initial)/10000:null,
   observedDrawdownPct:Number(drawdownBps)/10000,fills:fills.length,closed:closed.length,signedFills,eligible:reason===null,reason,
   evidence:{sessionId:input.report.sessionId,head:input.report.head,sequence:input.report.sequence}};
 });
 return {start:new Date(start).toISOString(),end:new Date(end).toISOString(),rows,eligible:rows.every(r=>r.eligible),reason:null,
  costs:'Quoted route economics are already included. Additional per-fill costs are an explicit estimate; network gas and setup costs are not automatically measured.',
  boundary:'Same observed period, different mandates and exposures. Small samples and operator-reported model execution do not establish trading skill.'};
}
