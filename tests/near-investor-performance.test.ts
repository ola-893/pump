import test from 'node:test';
import assert from 'node:assert/strict';
import { investorPerformance } from '../app/src/lib/agent-performance.js';
import type { Event, Session, Portfolio, Quote } from '../near-demo/types.js';
const createdAt='2026-10-26T00:00:00.000Z';
const portfolio=(cash='100000000',position='0',cost='0',realized='0'):Portfolio=>({cash,position,cost,realized,equity:position==='0'?cash:null,peak:'100000000',drawdownBps:0,maxDrawdownBps:0,markAt:null});
function fixture(){const s={id:'fixture-session',createdAt,agent:{id:'fixture-agent',strategyRunId:'fixture-run',modelId:'fixture-model',weightsHash:'fixture-hash'},config:{initialCash:'100000000'},sequence:0,head:null,portfolio:portfolio()} as unknown as Session;const events:Event[]=[];return {s,events};}
function event(f:ReturnType<typeof fixture>,kind:Event['kind'],after:Portfolio,details:Partial<Event>={}){const sequence=f.events.length+1;const e={id:`e${sequence}`,sessionId:f.s.id,sequence,previousHash:f.s.head,hash:`hash${sequence}`,at:new Date(Date.parse(createdAt)+sequence*60000).toISOString(),kind,evidence:'live-local-model',reason:'Named accounting fixture',before:f.s.portfolio,after,...details} as Event;f.events.push(e);f.s={...f.s,head:e.hash,sequence,portfolio:after};return e;}
const quote=(amountIn:string,amountOut:string,signed=true):Quote=>({id:'fixture-quote',source:'live',observedAt:createdAt,receivedAt:createdAt,tokenIn:'fixture-in',tokenOut:'fixture-out',amountIn,amountOut,minimumOut:'0',signatureVerified:signed,raw:{privateFixture:'not for export'}});

test('partial exits form one closed position and win rate does not count sell legs as trades',()=>{
 const f=fixture();event(f,'fill',portfolio('98000000','2000000000000000000000000','2000000'),{action:'BUY',quote:quote('2000000','2000000000000000000000000')});
 event(f,'fill',portfolio('99100000','1000000000000000000000000','1000000','100000'),{action:'SELL',quote:quote('1000000000000000000000000','1100000')});
 assert.equal(investorPerformance(f.s,f.events).closed.length,0);
 event(f,'fill',portfolio('99900000','0','0','-100000'),{action:'SELL',quote:quote('1000000000000000000000000','800000')});
 const p=investorPerformance(f.s,f.events);assert.equal(p.fills,3);assert.equal(p.closed.length,1);assert.equal(p.losses,1);assert.equal(p.wins,0);assert.equal(p.closed[0].pnl,'-100000');assert.equal(p.closed[0].entry,'2000000');
});
test('closed-position outcomes exclude a new open position and retain breakeven outcomes',()=>{
 const f=fixture();event(f,'fill',portfolio('98000000','2000000000000000000000000','2000000'),{action:'BUY',quote:quote('2000000','2000000000000000000000000')});
 event(f,'fill',portfolio('100000000'),{action:'SELL',quote:quote('2000000000000000000000000','2000000')});
 event(f,'fill',portfolio('99000000','1000000000000000000000000','1000000'),{action:'BUY',quote:quote('1000000','1000000000000000000000000')});
 const p=investorPerformance(f.s,f.events);assert.equal(p.closed.length,1);assert.equal(p.breakeven,1);assert.equal(p.wins,0);assert.equal(p.losses,0);
});
test('investor history preserves unavailable valuations and counts actual decision days',()=>{
 const f=fixture();event(f,'model',portfolio(),{model:{id:'fixture-model',raw:'private raw',request:{secretPrompt:'private'},proposal:{action:'HOLD',quoteUnits:'0',reason:'No signal'}}});
 event(f,'mark',{...portfolio(),equity:null},{evidence:'quote-mark'});event(f,'mark',{...portfolio(),equity:'99900000'},{evidence:'quote-mark'});
 const p=investorPerformance(f.s,f.events);assert.deepEqual(p.observations.map(o=>o.equity),['100000000',null,'99900000']);assert.equal(p.activeDays,1);assert.equal(p.activity.length,1);assert.equal(p.activity[0].action,'HOLD');assert.equal(p.closed.length,0);
 const json=JSON.stringify(p);assert.ok(!json.includes('private raw'));assert.ok(!json.includes('secretPrompt'));assert.ok(!json.includes('request'));
});
test('investor extraction rejects operator-directed, manual, cross-session and funded journals',()=>{
 for(const extra of [{evidence:'operator-directed-model'},{evidence:'manual-scenario'},{kind:'mandate'},{exerciseId:'old-exercise'},{sessionId:'foreign'}]){const f=fixture();event(f,'model',portfolio(),extra as Partial<Event>);assert.throws(()=>investorPerformance(f.s,f.events),/mixed/);}
 const f=fixture();f.s.testnet={account:'fixture.testnet',initialClaim:'100'};assert.throws(()=>investorPerformance(f.s,[]),/independent/);
});
test('only fill receipts count toward signed execution coverage and path details are removed',()=>{
 const f=fixture();event(f,'model',portfolio(),{quote:quote('1000000','1000000000000000000000000'),reason:'Local /Users/operator/private.gguf unavailable'});
 event(f,'fill',portfolio('99000000','1000000000000000000000000','1000000'),{action:'BUY',quote:quote('1000000','1000000000000000000000000',false)});
 const p=investorPerformance(f.s,f.events);assert.equal(p.fills,1);assert.equal(p.signedFills,0);assert.ok(!JSON.stringify(p).includes('/Users/'));assert.ok(!JSON.stringify(p).includes('privateFixture'));
});

test('dust loss is visible and closes a position without inflating fill or volume counts',()=>{
 const f=fixture();event(f,'fill',portfolio('90000000','2000000000000000000000000','10000000'),{action:'BUY',quote:quote('10000000','2000000000000000000000000')});
 event(f,'fill',portfolio('99900000','100000000000000000','1','-99999'),{action:'SELL',quote:quote('1999999900000000000000000','9900000')});
 event(f,'dust',portfolio('99900000','0','0','-100000'),{evidence:'paper-adjustment',reason:'One micro-USDC residual cost charged as a loss.'});
 const report=investorPerformance(f.s,f.events);assert.equal(report.fills,2);assert.equal(report.signedFills,2);assert.equal(report.closed.length,1);assert.equal(report.closed[0].pnl,'-100000');assert.equal(report.losses,1);assert.equal(report.activity[0].kind,'dust');assert.equal(report.activity[0].notional,null);assert.equal(report.activity[0].realized,'-1');assert.equal(report.observations.at(-1)!.equity,'99900000');
});

test('owner exits retain exact accounting and carry an explicit intervention marker',()=>{
 const f=fixture(),buy=event(f,'fill',portfolio('98000000','2000000000000000000000000','2000000'),{action:'BUY',quote:quote('2000000','2000000000000000000000000')});
 event(f,'fill',portfolio('100100000','0','0','100000'),{action:'SELL',evidence:'operator-exit',operatorExit:{expectedPosition:buy.after.position,lastFillHash:buy.hash},quote:quote(buy.after.position,'2100000'),reason:'Owner-requested paper exit'});
 const report=investorPerformance(f.s,f.events);assert.equal(report.operatorExits,1);assert.equal(report.fills,2);assert.equal(report.activity[0].operatorDirected,true);assert.equal(report.activity[0].realized,'100000');assert.equal(report.closed[0].pnl,'100000');
});
