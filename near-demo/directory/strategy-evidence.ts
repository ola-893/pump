import {digest,verifyHistory,freshQuote} from '../ledger.js';
import {verifyClassifierDecision} from '../classifier.js';
import {parseProposal} from '../model.js';
import {marketObservationSize,paperMarket,units} from '../types.js';
export function verifyPublishedStrategy(agent:any,run:any,history:any){
 const session=history.session,events=history.events;verifyHistory(session,events);
 if(run.agentId!==agent.id||run.registrationCommitment!==agent.commitment||session.agent?.id!==agent.id||session.agent?.strategyRunId!==run.id||session.agent?.weightsHash!==agent.manifest.model.sha256||digest(session.config)!==digest(run.config)||session.head!==run.session.head||session.sequence!==run.session.sequence)throw new Error('Published strategy and journal identity differ.');
 if(run.definition){
  const {commitment,...definition}=run.definition;
  const {endpoint:_endpoint,...publicConfig}=definition.config;
  if(commitment!==run.commitment||digest(definition)!==commitment||digest(publicConfig)!==digest(run.config))throw new Error('Published strategy definition differs from its commitment.');
  for(const key of ['id','agentId','sessionId','version','createdAt','label','registrationCommitment'])
   if(definition[key]!==run[key])throw new Error('Published strategy metadata differs from its committed definition.');
 }
 verifyStrategyDecisions(run,events,session.agent.modelId,agent.manifest.inference?.runtime);
 return true;
}
export function verifyStrategyDecisions(run:any,events:any[],modelId:string,runtime?:string){
 const {base,quote:quoteAsset}=paperMarket(run.config);
 let model:any=null;
 for(const e of events){
  if(e.kind==='mandate'||e.exercise||e.exerciseId||['operator-directed-model','operator-mandate','manual-scenario'].includes(e.evidence))throw new Error('Execution practice cannot be published as strategy performance.');
  if(e.evidence==='operator-exit'){
   if(!['fill','blocked'].includes(e.kind)||!e.operatorExit||e.model||e.kind==='fill'&&(e.action!=='SELL'||e.quote?.source!=='live'||e.quote?.amountIn!==e.before.position))throw new Error('Invalid owner-directed strategy exit.');
   model=null;continue;
  }
  if(e.kind==='model'){
   model=e;const m=e.model,input=JSON.parse(m?.request?.messages?.[1]?.content??'null');
   if(!m||!input||m.id!==modelId||input.strategy!==run.config.strategy||input.strategyVersion?.id!==run.id||input.strategyVersion?.commitment!==run.commitment||digest(input.portfolio)!==digest(e.before)||input.perTradeQuoteUnits!==run.config.tradeCap||input.allocatedCostCap!==run.config.exposureCap||input.dailyTurnoverCap!==run.config.dailyTurnoverCap||input.marketContext?.executionExercise||digest(JSON.parse(m.raw))!==digest(m.proposal))throw new Error('Published model response does not match this strategy and portfolio.');
   if(typeof run.config.market==='object'&&(!input.market||digest(input.market)!==digest(paperMarket(run.config))||!e.quote))
    throw new Error('Published model input does not identify the committed market and signed observation.');
   if(e.quote||input.recentMarketQuote){
    const quote=e.quote,observed=input.recentMarketQuote;
    if(!quote||!observed||quote.source!=='live'||observed.quoteId!==quote.id||
     ['tokenIn','tokenOut','amountIn','amountOut','observedAt'].some(key=>observed[key]!==quote[key])||Date.parse(quote.receivedAt)>Date.parse(e.at))
     throw new Error('Model market input differs from its signed quote.');
    if(quote.tokenIn!==quoteAsset||quote.tokenOut!==base||quote.amountIn!==marketObservationSize(run.config))throw new Error('Model quote differs from the strategy market.');
    freshQuote(quote,{config:run.config} as any,Date.parse(quote.receivedAt));
   }
   parseProposal(m.proposal);
   if(e.evidence!=='live-local-model')throw new Error('Unsupported model evidence.');
   if(runtime==='clef-mlx')verifyClassifierDecision(m);
  }
  if(e.kind==='fill'){
   const proposal=model?.model?.proposal;
   if(!proposal||proposal.action!==e.action||e.evidence!=='live-local-model'||e.quote?.source!=='live'||e.reason!==proposal.reason||
    e.action==='BUY'&&(e.quote.tokenIn!==quoteAsset||e.quote.amountIn!==proposal.quoteUnits)||
    e.action==='SELL'&&e.quote.tokenIn!==base||units(proposal.quoteUnits,false)>units(run.config.tradeCap))
    throw new Error('Strategy fill has no matching unused model decision, quantity and live quote.');
   model=null;
  }
  if(e.kind==='hold'){
   if(!model||model.model.proposal.action!=='HOLD'||e.reason!==model.model.proposal.reason)throw new Error('Strategy HOLD has no matching unused model decision.');
   model=null;
  }
  if(e.kind==='blocked')model=null;
 }
 return true;
}
