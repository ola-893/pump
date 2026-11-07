import test from 'node:test';
import assert from 'node:assert/strict';
import { applyVaultCapital, initialPortfolio, makeEvent, metrics, verifyHistory } from '../near-demo/ledger.js';
import { publicJournalEvent } from '../near-demo/directory/public-journal.js';
import type { Session } from '../near-demo/types.js';

const at='2026-11-07T10:30:00.000Z';
const observation={assets:'21000000',nonce:3,contractId:'s10fb2956e7f62e21b03bc801.pl.pumpcoin-demo-472db8.testnet',blockHash:'4'.repeat(44)};
const session:Session={
  id:'paper-strategy-v1',version:1,createdAt:at,state:'stopped',revision:0,sequence:0,head:null,turnover:{day:'',used:'0'},
  agent:{id:'agent',modelId:'test',weightsHash:'test',strategyRunId:'strategy-v1'},
  config:{name:'Vault capital test',initialCash:'1000000',tradeCap:'20000000',exposureCap:'80000000',dailyTurnoverCap:'100000000',
    slippageBps:50,executionDelayMs:1000,maxQuoteAgeMs:30000,source:'live',endpoint:'http://127.0.0.1:8093/v1',strategy:'Test only',intervalMs:60000},
  portfolio:initialPortfolio('1000000'),
};

test('a confirmed 20 USDC deposit increases 1 USDC paper equity to 21 with no simulated profit',()=>{
  const before=makeEvent(session,{at,kind:'hold',evidence:'live-local-model',reason:'Historical hold',after:session.portfolio});
  const existing={...session,sequence:before.sequence,head:before.hash};
  verifyHistory(existing,[before]);
  const after=applyVaultCapital(existing,observation,at);
  const event=makeEvent(existing,{at,kind:'mark',evidence:'paper-adjustment',reason:'Vault capital',vaultCapital:observation,after});
  const next={...existing,sequence:event.sequence,head:event.hash,portfolio:after};
  assert.equal(next.config.initialCash,'1000000');
  assert.equal(verifyHistory(next,[before,event]).portfolio.cash,'21000000');
  assert.equal(metrics(next).total,'0');
  assert.equal(metrics(next).returnBps,0);
  assert.equal(publicJournalEvent(event).equity,'21000000');
  assert.equal(publicJournalEvent(event).realized,'0');
  assert.throws(()=>applyVaultCapital(next,observation,at),/stale vault capital/);
  const empty={...next,portfolio:applyVaultCapital(next,{...observation,assets:'0',nonce:5},at)};
  assert.equal(empty.portfolio.cash,'0');
  assert.equal(metrics(empty).returnBps,null);
});

test('capital updates preserve inventory, quote freshness and existing P&L',()=>{
  const open={...session,portfolio:{...session.portfolio,cash:'500000',cost:'500000',position:'100000000000000000000000',equity:'950000',markAt:at}};
  const after=applyVaultCapital(open,observation,'2026-11-07T10:31:00.000Z');
  assert.equal(after.position,open.portfolio.position);
  assert.equal(after.cost,open.portfolio.cost);
  assert.equal(after.markAt,at);
  assert.equal(metrics({...open,portfolio:after}).total,'-50000');
  assert.throws(()=>applyVaultCapital(open,{...observation,assets:'0'},at),/exceeds available paper cash/);
});
