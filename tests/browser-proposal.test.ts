import test from 'node:test';
import assert from 'node:assert/strict';
import { browserProposalRequest } from '../app/src/lib/browser-proposal.js';
import { initialPortfolio } from '../near-demo/paper-state.js';
import { USDC, WNEAR, type Config, type Session, type Quote } from '../near-demo/types.js';
import type { MarketContext } from '../near-demo/market-context.js';

test('repeat browser decisions do not serialize the run journal or recursively embed previous prompts',()=>{
  const config:Config={name:'Prompt regression',strategy:'Hold when observations do not support an entry.',
    initialCash:'10000',tradeCap:'1000',exposureCap:'8000',dailyTurnoverCap:'10000',
    slippageBps:50,intervalMs:60000,executionDelayMs:1500,maxQuoteAgeMs:30000,
    source:'live',endpoint:'http://127.0.0.1/v1'};
  const session:Session={id:'session',version:1,createdAt:new Date().toISOString(),config,
    portfolio:initialPortfolio(config.initialCash),state:'stopped',revision:0,sequence:0,head:null,
    turnover:{day:'',used:'0'},agent:{id:'agent',modelId:'model',weightsHash:'a'.repeat(64),strategyRunId:'strategy'}};
  const quote={id:'quote',source:'live',signatureVerified:true,tokenIn:USDC,tokenOut:WNEAR,amountIn:'1000000',amountOut:'100000000000000000000000',
    observedAt:new Date().toISOString(),receivedAt:new Date().toISOString()} as Quote;
  const binding={id:'strategy',commitment:'b'.repeat(64)};
  const context:MarketContext={version:'PUMPCOIN-QUOTE-CONTEXT-v1',source:'live',samples:[],sampleCount:0,
    spanMs:0,outputChangeBps:null,scope:'Regression fixture'};
  const baseline=browserProposalRequest(session,quote,binding,context);
  const provenance=JSON.parse(baseline.messages[1].content).marketDataProvenance;
  assert.deepEqual(provenance,{source:'live',signatureVerified:true,quotes:'live signed dry-run quotes',execution:'simulated paper fills'});
  assert.match(baseline.messages[0].content,/Describe these quotes as live/);
  const replay=browserProposalRequest(session,{...quote,source:'replay',signatureVerified:false},binding,{...context,source:'replay'});
  assert.equal(JSON.parse(replay.messages[1].content).marketDataProvenance.quotes,'synthetic replay observations');
  assert.throws(()=>browserProposalRequest(session,quote,binding,{...context,source:'replay'}),/quote source/);
  assert.throws(()=>browserProposalRequest(session,{...quote,signatureVerified:false},binding,context),/verified live quote/);
  const storedRun={...binding,config,paper:{session,events:[{model:{request:baseline,privateMarker:'previous-prompt-marker'}}]}};
  for(let i=0;i<20;i++){
    const next=browserProposalRequest(session,quote,storedRun,context);
    const input=JSON.parse(next.messages[1].content);
    assert.deepEqual(input.marketContext.strategyVersion,binding);
    assert.equal(JSON.stringify(next).length,JSON.stringify(baseline).length);
    assert.ok(!JSON.stringify(next).includes('previous-prompt-marker'));
    storedRun.paper.events.push({model:{request:next,privateMarker:'previous-prompt-marker'}});
  }
});
