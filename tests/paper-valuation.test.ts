import {test} from 'node:test';import assert from 'node:assert/strict';
import {paperValuation} from '../app/src/lib/paper-valuation.js';
test('display switches from a retained timestamped valuation to the latest quote without confusing unknown with zero',()=>{
 const session={createdAt:'2026-11-03T00:00:00Z',valuationStale:true,portfolio:{equity:null as string|null,realized:'-900000',markAt:null as string|null},lastValuation:{equity:'99000000',at:'2026-11-03T01:00:00Z',realized:'-200000',sequence:5}};
 const old=paperValuation(session,'100000000');assert.equal(old?.equity,'99000000');assert.equal(old?.total,'-1000000');assert.equal(old?.unrealized,'-800000');assert.equal(old?.at,session.lastValuation.at);assert.equal(old?.stale,true);
 const fresh=paperValuation({...session,valuationStale:false,portfolio:{equity:'101000000',realized:'-900000',markAt:'2026-11-03T02:00:00Z'}},'100000000');
 assert.equal(fresh?.equity,'101000000');assert.equal(fresh?.total,'1000000');assert.equal(fresh?.unrealized,'1900000');assert.equal(fresh?.at,'2026-11-03T02:00:00Z');assert.equal(fresh?.stale,false);
 assert.equal(paperValuation({...session,lastValuation:undefined},'100000000'),null);
 assert.equal(paperValuation({...session,valuationStale:false,portfolio:{equity:'0',markAt:null,realized:'-100000000'}},'100000000')?.equity,'0');
 const funded={...session,portfolio:{...session.portfolio,vaultCapital:{assets:'21000000'}},
  lastValuation:{...session.lastValuation,equity:'20909928',realized:'0',capital:'21000000'}};
 assert.equal(paperValuation(funded,'1000000')?.total,'-90072');
});
