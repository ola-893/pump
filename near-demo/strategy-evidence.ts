import {digest,verifyHistory} from './ledger.js';
import {verifyPublishedStrategy} from './directory/strategy-evidence.js';

/** Verifies an exported strategy without access to the operator database or signer. */
export function verifyStrategyEvidence(bundle:any){
 if(bundle?.version!=='PUMP-STRATEGY-EVIDENCE-v1')throw new Error('Unsupported strategy evidence.');
 const {strategy,registration,paper}=bundle;
 const {commitment,...definition}=strategy;
 if(digest(definition)!==commitment||registration.commitment!==digest(registration.manifest)||strategy.agentId!==registration.id)
  throw new Error('Strategy or registration commitment differs from its definition.');
 verifyPublishedStrategy(registration,{...strategy,session:paper.session},paper);
 const replay=verifyHistory(paper.session,paper.events);
 return {valid:true,agentId:registration.id,strategyId:strategy.id,strategyHash:commitment,
  modelWeightsHash:registration.manifest.model.sha256,events:replay.events,head:replay.head,
  decisions:paper.events.filter((e:any)=>e.kind==='model').length,
  signedFills:paper.events.filter((e:any)=>e.kind==='fill').length,
  boundary:'Checks saved strategy, raw responses, one-use model decisions, signed quote bindings and paper accounting. Historical model execution requires separate attestation.'};
}

export function verifyStrategyVault(bundle:any,state:any){
 const result=verifyStrategyEvidence(bundle);
 if(state.agent_id!==result.agentId||state.strategy_id!==result.strategyId||state.strategy_hash!==result.strategyHash||
  state.manifest_hash!==bundle.registration.commitment||state.controller_id!==bundle.registration.manifest.controller)
  throw new Error('Strategy evidence differs from the on-chain vault commitment.');
 return result;
}
