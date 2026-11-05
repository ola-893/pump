import {test} from 'node:test';import assert from 'node:assert/strict';
import {commonPeriod} from '../app/src/lib/common-period.js';
import type {AgentPerformance} from '../app/src/lib/agent-performance.js';
const start=Date.parse('2026-11-03T10:00:00Z');const at=(n:number)=>new Date(start+n*60000).toISOString();
function input(id:string,begin=0){const observations=Array.from({length:11-begin},(_,i)=>({at:at(begin+i),sequence:i,equity:String(100000000+(begin+i)*100000)}));
 return {id,name:id,report:{createdAt:at(begin),firstDecision:at(begin),observations,activity:[2,4,6,8].map(n=>({kind:'fill',at:at(n),quote:{signed:true,source:'live'}})),closed:[{openedAt:at(1),closedAt:at(4)},{openedAt:at(5),closedAt:at(8)}],sessionId:id,head:'hash-'+id,sequence:20} as AgentPerformance};}
test('comparison uses overlap rather than mismatched lifetime returns',()=>{const a=input('a'),b=input('b',3);const r=commonPeriod([a,b]);assert.equal(r.start,at(3));assert.equal(r.end,at(10));assert.equal(r.rows[0].startingEquity,'100300000');assert.equal(r.rows[1].startingEquity,'100300000');assert.equal(r.rows[0].returnPct,r.rows[1].returnPct);});
test('explicit trading costs reduce return and affect observed drawdown without inventing gas',()=>{const a=input('a'),b=input('b');const noCost=commonPeriod([a,b]),withCost=commonPeriod([a,b],'1000000');assert.equal(withCost.rows[0].extraCosts,'4000000');assert.equal(withCost.rows[0].adjustedPnl,'-3000000');assert.ok(withCost.rows[0].returnPct!<noCost.rows[0].returnPct!);assert.ok(withCost.rows[0].observedDrawdownPct>0);assert.equal(withCost.eligible,true);});
test('missing overlap, gaps and insufficient closed samples cannot produce a comparable ranking',()=>{const a=input('a'),b=input('b');b.report.observations=b.report.observations.slice(0,1);assert.equal(commonPeriod([a,b]).eligible,false);
 const c=input('c');c.report.observations=c.report.observations.filter((_,i)=>i===0||i===10);assert.match(commonPeriod([a,c]).rows[1].reason!,/gaps/);
 const d=input('d');d.report.closed=[];assert.match(commonPeriod([a,d]).rows[1].reason!,/closed positions/);});
test('a distant boundary is not silently interpolated and one chosen record is not a comparison',()=>{const a=input('a'),b=input('b',5);a.report.observations=a.report.observations.filter((_,i)=>i===0||i>=6);assert.match(commonPeriod([a,b]).rows[0].reason!,/Boundary|gaps/);assert.throws(()=>commonPeriod([a]),/two/);});

test('unsigned or replay fills cannot qualify for comparison',()=>{
 const a=input('a'),b=input('b');b.report.activity[0].quote!.signed=false;
 assert.match(commonPeriod([a,b]).rows[1].reason!,/verified live quote/);
 b.report.activity[0].quote!.signed=true;b.report.activity[0].quote!.source='replay';
 assert.equal(commonPeriod([a,b]).eligible,false);
});

test('owner intervention excludes even later observed returns from autonomous comparison',()=>{
 const a=input('a'),b=input('b');b.report.operatorExits=1;
 const result=commonPeriod([a,b]);assert.equal(result.eligible,false);assert.equal(result.rows[0].eligible,true);assert.match(result.rows[1].reason!,/Owner-directed exit/);
});
