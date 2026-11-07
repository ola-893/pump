import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ed25519 } from '@noble/curves/ed25519';
import { base58 } from '@scure/base';
import { PumpDirectory, publicationHash } from '../near-demo/directory/service.js';
import { journalSchema, paperPnlAt, publicJournalEvent, type JournalBatch, type JournalMark, type PublicJournalEvent } from '../near-demo/directory/public-journal.js';
import type { Event } from '../near-demo/types.js';
import { publicPaperPnl } from '../app/src/lib/public-paper-pnl.js';

test('live quotes add P&L observations without creating decisions and reject mismatched portfolios',()=>{
  const {exit:quote}=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-sol-eth-dry-quotes.json',import.meta.url),'utf8'));
  const now=Date.parse(quote.receivedAt),db=new DatabaseSync(':memory:');
  try {
    const directory=new PumpDirectory(db,'http://127.0.0.1:5198',undefined,()=>now);
    const secret=new Uint8Array(32).fill(41),key='ed25519:'+base58.encode(ed25519.getPublicKey(secret));
    const agent={id:'00000000-0000-4000-8000-000000000011',name:'Live chart',model:'Fixture',controller:'owner.testnet'};
    const strategy={id:'00000000-0000-4000-8000-000000000012',version:1,market:'SOL / ETH',openingSequence:0};
    db.prepare('INSERT INTO directory_runners(owner,key,proof) VALUES(?,?,?)').run(agent.controller,key,'{}');
    const send=(events:PublicJournalEvent[],marks?:JournalMark[])=>{
      const batch:JournalBatch={schema:journalSchema,agent,strategy,events,...(marks?{marks}:{})};
      return directory.journals.publish(batch,key,Buffer.from(ed25519.sign(publicationHash(batch),secret)).toString('base64'));
    };
    const event:PublicJournalEvent={at:quote.receivedAt,sequence:1,sourceHash:'a'.repeat(64),kind:'fill',action:'BUY',equity:null,realized:'0',receipt:null};
    send([event]);
    const observation:JournalMark={at:quote.receivedAt,sequence:1,sourceHash:event.sourceHash,equity:'1001000',totalPnl:'1000',quote};
    send([],[observation]);
    const page=directory.journals.page(agent.id);
    assert.equal(page.events.length,1);
    assert.equal(page.marks?.[0].totalPnl,'1000');
    assert.equal('quote' in page.marks![0],false);
    assert.throws(()=>send([],[{...observation,sourceHash:'b'.repeat(64)}]),/does not match/);
    assert.throws(()=>send([],[{...observation,sequence:0}]),/older portfolio/);
    assert.throws(()=>send([],[{...observation,totalPnl:'2000'}]),/cannot be rewritten/);
    assert.throws(()=>send([],[{...observation,quote:{...quote,amountOut:String(BigInt(quote.amountOut)+1n)}}]),/signature/);
    const pnl=publicPaperPnl([event],page.marks);
    assert.equal(pnl.latest?.equity,'1000');
    assert.equal(pnl.realized,'0');
  } finally { db.close(); }
});

test('public paper valuations exclude capital and include unrealized gains only at a recorded mark', () => {
  const mark = (equity:string, assets:string, position='0', signed=false) => ({
    kind:'mark', after:{equity,position,vaultCapital:{assets}}, quote:{signatureVerified:signed},
  } as unknown as Event);
  assert.equal(paperPnlAt(mark('1000000','1000000'),'1000000'),0n);
  assert.equal(paperPnlAt(mark('21000000','21000000'),'1000000'),0n);
  const unrealized=paperPnlAt(mark('21090000','21000000','100',true),'1000000');
  assert.equal(unrealized,90000n);
  assert.equal(paperPnlAt(mark('21090000','21000000','100'),'1000000'),null);
  const opened = { at:'2026-11-07T11:54:49.000Z', totalPnl:String(unrealized), realized:'0' };
  const sold = { at:'2026-11-07T12:02:57.000Z', totalPnl:'-94626', realized:'-94626' };
  const old = { at:'2026-11-07T11:47:10.000Z', realized:'0' };
  assert.deepEqual(publicPaperPnl([sold,opened,old]), {
    realized:'-94626', observations:[{at:opened.at,equity:'90000'},{at:sold.at,equity:'-94626'}],
    latest:{at:sold.at,equity:'-94626'},
  });
});

test('public journal requires owner authorization, rejects gaps and rewrites, and pages the signed record', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const directory = new PumpDirectory(db, 'http://127.0.0.1:5198');
    const secret = new Uint8Array(32).fill(42);
    const key = `ed25519:${base58.encode(ed25519.getPublicKey(secret))}`;
    const agent = { id: '00000000-0000-4000-8000-000000000001', name: 'Test agent', model: 'Test model', controller: 'owner.testnet' };
    const strategy = { id: '00000000-0000-4000-8000-000000000002', version: 1, market: 'wNEAR / USDC', openingSequence: 7 };
    const publish = (events: PublicJournalEvent[], selected:JournalBatch['strategy']=strategy) => {
      const batch: JournalBatch = { schema: journalSchema, agent, strategy:selected, events };
      const signature = Buffer.from(ed25519.sign(publicationHash(batch), secret)).toString('base64');
      return directory.journals.publish(batch, key, signature);
    };
    const event = (sequence: number): PublicJournalEvent => ({
      sequence, at: '2026-10-21T12:00:00.000Z', kind: 'hold', action: 'HOLD',
      receipt: null, equity: '100000000', realized: '0', sourceHash: sequence.toString(16).padStart(64, '0'),
    });
    assert.throws(() => publish([]), /not authorized/);
    db.prepare('INSERT INTO directory_runners(owner,key,proof) VALUES(?,?,?)').run(agent.controller, key, '{}');
    assert.throws(() => publish([event(9)]), /missing an earlier event/);
    assert.equal(directory.journals.catalog(0).agents.length, 0);
    assert.equal(publish(Array.from({ length: 100 }, (_, index) => event(index + 8))).head, 107);
    assert.equal(publish([event(107), event(108)]).head, 108);
    assert.throws(() => publish([{ ...event(108), action: 'BUY' }]), /cannot be rewritten/);
    assert.throws(() => publish([{ ...event(109), raw: 'private input' } as PublicJournalEvent]), /Invalid public decision event/);
    const latest = directory.journals.page(agent.id);
    assert.equal(latest.events.length, 100);
    assert.equal(latest.events[0].sequence, 108);
    assert.equal(latest.nextBefore, 9);
    assert.deepEqual(directory.journals.page(agent.id, strategy.id, latest.nextBefore!).events.map(item => item.sequence), [8]);
    assert.throws(() => publish([{...event(9),totalPnl:'0'}]), /missing an earlier event/);
    assert.equal(publish([{...event(8),totalPnl:'0'},{...event(9),totalPnl:null}]).head,108);
    assert.equal(publish([event(8)]).head,108);
    assert.throws(() => publish([{...event(8),totalPnl:'1'}]), /valuation cannot be rewritten/);
    assert.throws(() => publish([{...event(8),equity:'2',totalPnl:'0'}]), /event cannot be rewritten/);
    const valued = directory.journals.page(agent.id, strategy.id, 10);
    assert.equal(valued.strategies[0].valuedThrough,9);
    assert.deepEqual(valued.events.map(item => item.totalPnl),[null,'0']);
    assert.deepEqual(directory.journals.catalog(0).agents[0].activity, {
      version:1, market:strategy.market, hasTradingRecord:true, decisions:0, fills:0, buys:0, sells:0,
    });
    const funded={...strategy,id:'00000000-0000-4000-8000-000000000003',version:2,openingSequence:0,vault:{
      contractId:'sabcdef.pl.owner.testnet',manifestHash:'a'.repeat(64),strategyHash:'b'.repeat(64),seedAmount:'10000',seedReceipt:'c'.repeat(44),
    }};
    publish([],funded);
    assert.equal(directory.journals.catalog(0).agents[0].strategyVault,funded.vault.contractId);
    assert.equal(directory.journals.catalog(0).agents[0].activity?.hasTradingRecord,false);
    publish([
      {...event(1),kind:'model',action:'BUY'},
      {...event(2),kind:'fill',action:'BUY'},
      {...event(3),kind:'fill',action:'SELL'},
    ],funded);
    assert.deepEqual(directory.journals.catalog(0).agents[0].activity, {
      version:2, market:strategy.market, hasTradingRecord:true, decisions:1, fills:2, buys:1, sells:1,
    });
    assert.deepEqual(directory.journals.page(agent.id).strategies[0].vault,funded.vault);
    assert.throws(()=>publish([],{...funded,vault:{...funded.vault,seedAmount:'20000'}}),/identity cannot be changed/);
    db.prepare('UPDATE directory_runners SET revoked=1').run();
    assert.throws(() => publish([event(109)]), /not authorized/);
  } finally {
    db.close();
  }
});

test('public event projection omits model prompts, raw replies, reasons, and unverified quote data', () => {
  const original = {
    sequence: 9, at: '2026-10-21T12:00:00.000Z', kind: 'model', reason: 'private note',
    model: { request: { prompt: 'private prompt' }, raw: 'private reply', proposal: { action: 'HOLD' } },
    before: { realized: '0' }, after: { realized: '0', equity: '100000000' },
    quote: { id: 'secret-unverified-quote', signatureVerified: false }, hash: 'a'.repeat(64),
  } as unknown as Event;
  const publicEvent = publicJournalEvent(original);
  assert.equal(publicEvent.action, 'HOLD');
  assert.equal(publicEvent.receipt, null);
  assert.doesNotMatch(JSON.stringify(publicEvent), /private|unverified/);
});
