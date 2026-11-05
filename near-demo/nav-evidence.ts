import {canonical,digest,freshQuote,verifyHistory} from './ledger.js';
import {paperMarket,units,vaultEquity} from './types.js';
/** Independently recomputes arithmetic and signed quote bindings; never attests model execution. */
export function verifyNavEvidence(bundle:any){
 if(bundle?.schema!=='PUMP-NAV-EVIDENCE-v1')throw new Error('Unsupported valuation evidence.');
 const {valuation:v,args,receipt}=bundle;
 if(args.evidence_hash!==digest(v)||args.run_id!==bundle.runId||args.strategy_hash!==bundle.strategyHash||v.strategy!==bundle.strategyHash||args.equity!==v.equity||args.observed_at_ms!==v.observedAt||args.tracking!==v.tracking)throw new Error('Valuation commitment differs from reported arguments.');
 const definition=v.strategyDefinition;
 if(typeof v.sourceSession?.config?.market==='object'&&!definition)throw new Error('Custom-market valuation requires the committed strategy.');
 if(definition){
  const {commitment,...body}=definition;
  if(commitment!==v.strategy||digest(body)!==commitment||definition.id!==bundle.runId||!v.sourceSession||digest(definition.config)!==digest(v.sourceSession.config)||definition.sessionId!==v.sourceSession.id)throw new Error('Valuation market does not match the committed strategy.');
 }
 const {base,quote}=paperMarket(definition?.config);
 const cash=units(v.portfolio.cash),position=units(v.portfolio.position);let value=cash;
 if(position>0n){const q=v.quote;if(!q||q.tokenIn!==base||q.tokenOut!==quote||q.amountIn!==v.portfolio.position)throw new Error('Liquidation quote does not cover this whole position.');
  freshQuote(q,{config:{source:'live',maxQuoteAgeMs:30000}},v.observedAt);value+=units(q.amountOut);
 }else if(v.quote)throw new Error('A cash-only portfolio cannot add a liquidation quote.');
 if((definition?vaultEquity(definition.config,String(value)):String(value))!==v.equity)throw new Error('Reported equity differs from cash plus liquidation proceeds.');
 if(bundle.history){const h=bundle.history;verifyHistory(h.session,h.events);if(definition&&digest(h.session.config)!==digest(definition.config)||h.session.sequence!==v.paperSequence||h.session.head!==v.head||digest(h.session.portfolio)!==digest(v.portfolio))throw new Error('Source journal differs from valuation snapshot.');}
 if(receipt?.final_execution_status!=='FINAL'||typeof receipt.status!=='object'||!('SuccessValue' in receipt.status)||receipt.transaction?.hash!==bundle.transactionHash||receipt.transaction?.signer_id!==bundle.reporterId||receipt.transaction?.receiver_id!==bundle.contractId)throw new Error('Confirmed transaction identity differs from this vault.');
 const actions=receipt.transaction.actions;if(!Array.isArray(actions)||actions.length!==1||actions[0].FunctionCall?.method_name!=='report_nav'||String(actions[0].FunctionCall.deposit)!=='0')throw new Error('Transaction is not a NAV report.');
 const actual=JSON.parse(Buffer.from(actions[0].FunctionCall.args,'base64').toString());if(canonical(actual)!==canonical(args))throw new Error('Transaction arguments differ from the evidence.');
 if([receipt.transaction_outcome,...receipt.receipts_outcome].some(x=>x?.outcome?.status?.Failure))throw new Error('NAV transaction contains a failed receipt.');
 return {valid:true,equity:v.equity,sourceJournal:!!bundle.history,quoteSignature:position>0n?'verified':'cash-only',transactionHash:bundle.transactionHash,
  boundary:'Verifies evidence integrity, journal accounting and signed quote bindings. Chain authenticity requires fetching this transaction from a trusted RPC. This does not attest model execution or the truth of an operator-supplied journal.'};
}
