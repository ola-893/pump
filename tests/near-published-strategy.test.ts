import {test} from 'node:test';import assert from 'node:assert/strict';
import {USDC} from '../near-demo/types.js';
import {initialPortfolio,makeEvent,digest} from '../near-demo/ledger.js';
import {verifyStrategyEvidence,verifyStrategyVault} from '../near-demo/strategy-evidence.js';
import {verifyStrategyDecisions,verifyPublishedStrategy} from '../near-demo/directory/strategy-evidence.js';
function fixture(change=false){const run:any={id:'run',agentId:'agent',registrationCommitment:'manifest',commitment:'strategy',config:{initialCash:'100000000',strategy:'Declared fixture strategy',tradeCap:'5000000',exposureCap:'10000000',dailyTurnoverCap:'50000000'}};
 const agent:any={id:'agent',commitment:'manifest',manifest:{model:{sha256:'weights'}}};
 const session:any={id:'session',createdAt:'2026-11-03T10:00:00Z',config:run.config,portfolio:initialPortfolio('100000000'),sequence:0,head:null,turnover:{day:'',used:'0'},agent:{id:'agent',strategyRunId:'run',modelId:'fixture',weightsHash:'weights'}};
 const input={strategy:run.config.strategy,strategyVersion:{id:run.id,commitment:run.commitment},portfolio:session.portfolio,perTradeQuoteUnits:change?'999999999':run.config.tradeCap,allocatedCostCap:run.config.exposureCap,dailyTurnoverCap:run.config.dailyTurnoverCap,marketContext:{}};
 const proposal={action:'HOLD',quoteUnits:'0',reason:'Named fixture response.'};
 const event=makeEvent(session,{kind:'model',evidence:'live-local-model',at:'2026-11-03T10:00:01Z',reason:proposal.reason,after:session.portfolio,model:{id:'fixture',proposal:proposal as any,raw:JSON.stringify(proposal),request:{messages:[{content:''},{content:JSON.stringify(input)}]}}});
 session.sequence=1;session.head=event.hash;run.session=session;return {agent,run,history:{session,events:[event]}};}
test('a public strategy journal binds raw response, model identity, mandate and source portfolio',()=>{const f=fixture();assert.equal(verifyPublishedStrategy(f.agent,f.run,f.history),true);});
test('a hash-consistent journal cannot silently substitute the model mandate',()=>{const f=fixture(true);assert.throws(()=>verifyPublishedStrategy(f.agent,f.run,f.history),/model response/);});
test('model and raw-response substitutions are rejected even after recomputing journal hashes',()=>{const f=fixture();const e=f.history.events[0];e.model!.raw=JSON.stringify({action:'BUY',quoteUnits:'100',reason:'changed'});const {hash,...body}=e;e.hash=digest(body);f.history.session.head=e.hash;assert.throws(()=>verifyPublishedStrategy(f.agent,f.run,f.history),/model response/);});

test('a model decision cannot be reused after a fill or blocked outcome',()=>{
 const f=fixture(),model=f.history.events[0];
 const proposal={action:'BUY',quoteUnits:'1000000',reason:'One bounded entry.'};
 model.model!.proposal=proposal as any;model.model!.raw=JSON.stringify(proposal);
 const fill:any={kind:'fill',evidence:'live-local-model',action:'BUY',reason:proposal.reason,quote:{tokenIn:USDC,source:'live',amountIn:'1000000'}};
 assert.equal(verifyStrategyDecisions(f.run,[model,fill],'fixture'),true);
 assert.throws(()=>verifyStrategyDecisions(f.run,[model,fill,fill],'fixture'),/unused model/);
 assert.throws(()=>verifyStrategyDecisions(f.run,[model,{kind:'blocked'},fill],'fixture'),/unused model/);
 assert.throws(()=>verifyStrategyDecisions(f.run,[model,{...fill,quote:{...fill.quote,amountIn:'2000000'}}],'fixture'),/quantity/);
});
test('standalone strategy evidence verifies definitions and rejects rewritten commitments',()=>{
 const f=fixture();f.agent.manifest.controller='fixture.testnet';f.agent.commitment=digest(f.agent.manifest);
 f.run.registrationCommitment=f.agent.commitment;
 const {commitment,session,...definition}=f.run;f.run.commitment=digest(definition);
 const event=f.history.events[0],input=JSON.parse((event.model!.request as any).messages[1].content);
 input.strategyVersion.commitment=f.run.commitment;(event.model!.request as any).messages[1].content=JSON.stringify(input);
 const {hash,...body}=event;event.hash=digest(body);f.history.session.head=event.hash;
 const {session:_session,...strategy}=f.run;
 const bundle={version:'PUMP-STRATEGY-EVIDENCE-v1',registration:f.agent,strategy,paper:f.history};
 assert.equal(verifyStrategyEvidence(bundle).events,1);
 const state={agent_id:f.agent.id,strategy_id:strategy.id,strategy_hash:strategy.commitment,manifest_hash:f.agent.commitment,controller_id:f.agent.manifest.controller};
 assert.equal(verifyStrategyVault(bundle,state).valid,true);
 assert.throws(()=>verifyStrategyVault(bundle,{...state,strategy_hash:'another strategy'}),/on-chain/);
 bundle.strategy.config.strategy='A rewritten mandate';
 assert.throws(()=>verifyStrategyEvidence(bundle),/commitment/);
});
