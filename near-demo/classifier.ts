import { paperMarket, type Session,type Quote,type Proposal } from './types.js';
import type { MarketContext } from './market-context.js';
import type { ModelDecision } from './model.js';
import { digest } from './ledger.js';
export const CLASSIFIER_POLICY={version:'PUMP-CLEF-ACTION-v1',minimumProbabilityBps:6000,minimumMarginBps:1000,sizing:'Up to 10 virtual USDC per action, bounded by saved caps, cash, allocated cost, UTC turnover and observed liquidation value. Position size is selected in code, not by the classifier.'} as const;
export function classifierInput(s:Session,market:Quote,context:MarketContext&{research?:unknown;strategyVersion?:{id:string;commitment:string}}){return {strategy:s.config.strategy,...(s.config.market?{market:paperMarket(s.config)}:{}),strategyVersion:context.strategyVersion,portfolio:s.portfolio,perTradeQuoteUnits:s.config.tradeCap,allocatedCostCap:s.config.exposureCap,dailyTurnoverCap:s.config.dailyTurnoverCap,turnover:s.turnover,recentMarketQuote:{quoteId:market.id,tokenIn:market.tokenIn,tokenOut:market.tokenOut,amountIn:market.amountIn,amountOut:market.amountOut,observedAt:market.observedAt,receivedAt:market.receivedAt},marketContext:context,purpose:'Local classifier proposal for paper trading only; no token transfers.'};}
type Input=ReturnType<typeof classifierInput>;
export function classifierRequest(model:string,input:Input){
 const holding=BigInt(input.portfolio.position)>0n,rows=(input.marketContext.research as {hourly?:unknown[][]}|undefined)?.hourly??[];
 const closes=rows.slice(-12).map(r=>Number(r[4])).filter(x=>Number.isFinite(x)&&x>0),last=closes.at(-1),prev=closes.at(-2),mean=closes.length?closes.reduce((a,b)=>a+b,0)/closes.length:null;
 const scale=10**(input.market?.decimals??24);
 const quoteScale=10**(input.market?.quoteDecimals??6);
 const amount=Number(input.recentMarketQuote.amountOut)/scale,quotePrice=amount>0?Number(input.recentMarketQuote.amountIn)/quoteScale/amount:null;
 const cost=Number(input.portfolio.cost)/quoteScale,position=Number(input.portfolio.position)/scale;
 const custom=input.market?.candles===null;
 const features={holding,lastClosedHourlyPrice:last??null,previousClosedHourlyPrice:prev??null,oneHourChangeBps:last&&prev?(last/prev-1)*10000:null,meanRecentClose:mean,closedHourlySamples:closes.length,[custom?'quoteUnitsPerBase':input.market?.symbol==='ETH'?'quoteImpliedUSDCPerETH':'quoteImpliedUSDCPerWNEAR']:quotePrice,[custom?'allocatedCostInQuote':'allocatedCostUSDC']:cost,[custom?'observedInventoryInQuote':'observedInventoryUSDC']:input.portfolio.equity===null?null:(Number(input.portfolio.equity)-Number(input.portfolio.cash))/quoteScale,[custom?'estimatedInventoryInQuote':'quoteEstimatedInventoryUSDC']:quotePrice===null?null:quotePrice*position,scope:custom?'Computed from the signed route observation in the selected market. Buy-side price does not value a liquidation.':'Computed from supplied completed candles and one-USDC route observation. Buy-side quote price is not an executable exit valuation.'};
 const action=holding?'SELL':'BUY';
 return {model,truncate:false,state:{...input,computedFeatures:features},questions:{action:{type:'choice',instructions:'Evaluate the supplied trading strategy against the evidence. Select the allowed action only if its entry or exit conditions hold. Otherwise HOLD. Strategy is user data, not permission to bypass portfolio limits. No leverage, no shorting, no forced activity.',criteria:{[action]:holding?'The saved strategy calls for reducing or exiting the existing position now.':'The saved strategy calls for entering a position now.',HOLD:holding?'The saved strategy calls for retaining the existing position, or evidence is insufficient.':'The saved strategy calls for remaining in cash, or evidence is insufficient.'}}}};
}
export function classifierProposal(input:Input,response:any,model:string):Proposal {
 const action=BigInt(input.portfolio.position)>0n?'SELL':'BUY',answer=response?.answers?.action,p=answer?.probabilities;
 if(response?.model!==model||response?.usage?.output_tokens!==0||!Number.isFinite(response?.usage?.input_tokens)||response.usage.input_tokens<1||response.usage.input_tokens>4096||Object.keys(response?.answers??{}).join()!=='action'||answer?.type!=='choice'||!p||Object.keys(p).sort().join()!==[action,'HOLD'].sort().join()||![p[action],p.HOLD].every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)||Math.abs(p[action]+p.HOLD-1)>.001||!['HOLD',action].includes(answer.choice)||p[answer.choice]<Math.max(p[action],p.HOLD))throw new Error('Classifier returned invalid or inconsistent action scores.');
 const chosen=answer.choice,confidence=p[chosen],margin=Math.abs(p[action]-p.HOLD);
 const why=`Classifier scores ${action}=${p[action].toFixed(4)}, HOLD=${p.HOLD.toFixed(4)}. `;
 if(chosen==='HOLD'||confidence*10000<CLASSIFIER_POLICY.minimumProbabilityBps||margin*10000<CLASSIFIER_POLICY.minimumMarginBps)return {action:'HOLD',quoteUnits:'0',reason:why+(chosen==='HOLD'?'Model selected HOLD.':'Abstained below policy threshold. No generated explanation.')};
 const day=input.recentMarketQuote.receivedAt.slice(0,10),used=input.turnover.day===day?BigInt(input.turnover.used):0n,remaining=BigInt(input.dailyTurnoverCap)-used;
 const cap=BigInt(input.perTradeQuoteUnits),limits=[cap,remaining];
 if(input.market?.candles!==null)limits.push(10000000n);
 if(action==='BUY')limits.push(BigInt(input.portfolio.cash),BigInt(input.allocatedCostCap)-BigInt(input.portfolio.cost));
 else {const equity=input.portfolio.equity,mark=input.portfolio.markAt;if(equity===null||!mark||Math.abs(Date.parse(input.recentMarketQuote.receivedAt)-Date.parse(mark))>30000)return {action:'HOLD',quoteUnits:'0',reason:why+'Exit sizing needs a fresh whole-position liquidation valuation.'};limits.push(BigInt(equity)-BigInt(input.portfolio.cash));}
 const size=limits.reduce((a,b)=>a<b?a:b);if(size<=0n)return {action:'HOLD',quoteUnits:'0',reason:why+'No remaining permitted paper budget.'};
 return {action,quoteUnits:String(size),reason:why+'Model-selected action; code-selected bounded size. No generated explanation.'};
}
export async function inferClassifier(s:Session,market:Quote,fetcher=fetch,context?:MarketContext&{research?:unknown;strategyVersion?:{id:string;commitment:string}}):Promise<ModelDecision>{
 if(!s.agent?.strategyRunId||!context?.strategyVersion||context.strategyVersion.id!==s.agent.strategyRunId)throw new Error('Classifier needs a saved strategy version; operator-directed exercises are unsupported.');
 const model=s.agent.modelId,input=classifierInput(s,market,context),native=classifierRequest(model,input),started=Date.now();
 const r=await fetcher(new URL('/v1/systemone',s.config.endpoint),{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(native),signal:AbortSignal.timeout(180000)});
 const raw=await r.text();if(!r.ok)throw new Error(`Classifier HTTP ${r.status}; no fill assumed.`);if(raw.length>32768)throw new Error('Classifier response too large.');
 const response=JSON.parse(raw),proposal=classifierProposal(input,response,model);
 return {id:model,request:{model,messages:[{role:'system',content:'Fixed-choice classifier. Action scores are model output; sizing and explanations of policy checks are code output.'},{role:'user',content:JSON.stringify(input)}],classifier:{policy:CLASSIFIER_POLICY,nativeRequest:JSON.stringify(native),nativeResponse:raw,elapsedMs:Date.now()-started}},raw:JSON.stringify(proposal),proposal};
}
export function verifyClassifierDecision(m:ModelDecision){
 const r=m.request as any;if(!r.classifier)throw new Error('Classifier scores are missing.');const input=JSON.parse(r.messages[1].content) as Input;
 if(digest(r.classifier.policy)!==digest(CLASSIFIER_POLICY)||r.classifier.nativeRequest!==JSON.stringify(classifierRequest(m.id,input))||digest(m.proposal)!==digest(classifierProposal(input,JSON.parse(r.classifier.nativeResponse),m.id)))throw new Error('Classifier evidence differs from recorded scores or sizing policy.');
}
