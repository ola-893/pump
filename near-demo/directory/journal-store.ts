import type { DatabaseSync } from 'node:sqlite';
import { canonical } from '../paper-state.js';
import { freshQuote } from '../ledger.js';
import { testAccount } from '../types.js';
import { publicationHash, verifySignature } from './signatures.js';
import { journalBatchSize, journalSchema, type JournalBatch, type JournalListing, type JournalPage } from './public-journal.js';

const keys = (value: unknown, names: string) => !!value && typeof value === 'object' && Object.keys(value).sort().join(',') === names;
const uuid = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const amount = (value: unknown) => typeof value === 'string' && /^-?(0|[1-9][0-9]{0,37})$/.test(value);
const text = (value: unknown, limit: number) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const date = (value: unknown) => typeof value === 'string' && value.length === 24 && Number.isFinite(Date.parse(value));
const integer = (value: number) => Number.isSafeInteger(value) && value >= 0;
const eventKinds = ['dust', 'mandate', 'fill', 'hold', 'blocked', 'mark', 'model', 'testnet-link'];

function validateBatch(batch: JournalBatch) {
  if (!keys(batch, batch.marks===undefined?'agent,events,schema,strategy':'agent,events,marks,schema,strategy') || batch.schema !== journalSchema ||
    !keys(batch.agent, 'controller,id,model,name') || !uuid(batch.agent.id) || !text(batch.agent.name, 64) ||
    !text(batch.agent.model, 128) || !Array.isArray(batch.events) || batch.events.length > journalBatchSize) {
    throw new Error('Invalid public journal batch.');
  }
  testAccount(batch.agent.controller);
  if (batch.strategy === null && batch.events.length === 0 && batch.marks===undefined) return;
  const strategy = batch.strategy;
  if (!strategy || !keys(strategy, strategy.vault ? 'id,market,openingSequence,vault,version' : 'id,market,openingSequence,version') || !uuid(strategy.id) ||
    !text(strategy.market, 80) || !integer(strategy.openingSequence) || !integer(strategy.version) || strategy.version < 1) {
    throw new Error('Invalid public strategy identity.');
  }
  if (strategy.vault) {
    const vault=strategy.vault;
    if (!keys(vault,'contractId,manifestHash,seedAmount,seedReceipt,strategyHash') || !hash(vault.manifestHash) || !hash(vault.strategyHash) ||
        typeof vault.seedAmount!=='string'||!/^[1-9][0-9]{0,12}$/.test(vault.seedAmount) || BigInt(vault.seedAmount)>1_000_000_000_000n ||
        typeof vault.seedReceipt!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(vault.seedReceipt))
      throw new Error('Invalid public strategy vault.');
    testAccount(vault.contractId);
  }
  for (const event of batch.events) {
    const eventKeys = event && Object.hasOwn(event, 'totalPnl')
      ? 'action,at,equity,kind,realized,receipt,sequence,sourceHash,totalPnl'
      : 'action,at,equity,kind,realized,receipt,sequence,sourceHash';
    if (!keys(event, eventKeys) || !integer(event.sequence) ||
      !date(event.at) || !eventKinds.includes(event.kind) || ![null, 'BUY', 'SELL', 'HOLD'].includes(event.action) ||
      !hash(event.sourceHash) || event.equity !== null && !amount(event.equity) || !amount(event.realized) ||
      event.totalPnl != null && (event.equity === null || !amount(event.totalPnl))) {
      throw new Error('Invalid public decision event.');
    }
    const receipt = event.receipt;
    if (receipt !== null && (!keys(receipt, 'amountIn,amountOut,id,observedAt') ||
      !hash(receipt.id) || !date(receipt.observedAt) || !amount(receipt.amountIn) || !amount(receipt.amountOut))) {
      throw new Error('Invalid public quote receipt.');
    }
  }
  if (batch.marks!==undefined) {
    if(!Array.isArray(batch.marks)||batch.marks.length>journalBatchSize) throw new Error('Invalid public live valuations.');
    for(const mark of batch.marks) {
      if(!keys(mark,'at,equity,quote,sequence,sourceHash,totalPnl')||!date(mark.at)||!integer(mark.sequence)||
        !hash(mark.sourceHash)||!amount(mark.equity)||BigInt(mark.equity)<0n||!amount(mark.totalPnl))
        throw new Error('Invalid public live valuation.');
      freshQuote(mark.quote,{config:{source:'live',maxQuoteAgeMs:30000}},Date.parse(mark.at));
    }
  }
}

export class PublicJournalStore {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  constructor(db: DatabaseSync, now: () => number) {
    this.db = db;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS journal_agents(id TEXT PRIMARY KEY, owner TEXT NOT NULL, body TEXT NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS journal_strategies(id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, body TEXT NOT NULL, head INTEGER NOT NULL, updated INTEGER NOT NULL,
        FOREIGN KEY(agent_id) REFERENCES journal_agents(id));
      CREATE INDEX IF NOT EXISTS journal_strategies_agent ON journal_strategies(agent_id);
      CREATE TABLE IF NOT EXISTS journal_batches(hash TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS journal_events(strategy_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(strategy_id, sequence), FOREIGN KEY(strategy_id) REFERENCES journal_strategies(id));
      CREATE TABLE IF NOT EXISTS journal_valuations(strategy_id TEXT NOT NULL, sequence INTEGER NOT NULL, total_pnl TEXT,
        PRIMARY KEY(strategy_id, sequence), FOREIGN KEY(strategy_id, sequence) REFERENCES journal_events(strategy_id, sequence));
      CREATE TABLE IF NOT EXISTS journal_marks(strategy_id TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(strategy_id,at), FOREIGN KEY(strategy_id) REFERENCES journal_strategies(id));
    `);
  }

  publish(batch: JournalBatch, key: string, signature: string) {
    validateBatch(batch);
    if (typeof signature !== 'string' || !verifySignature(key, publicationHash(batch), Buffer.from(signature, 'base64'))) {
      throw new Error('Invalid public journal signature.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const { agent, strategy, events } = batch;
      const authorized = this.db.prepare('SELECT 1 FROM directory_runners WHERE owner=? AND key=? AND revoked=0').get(agent.controller, key);
      if (!authorized) throw new Error('This wallet has not authorized the publisher.');
      const legacy = this.db.prepare('SELECT owner FROM directory_agents WHERE id=?').get(agent.id);
      const priorAgent = this.db.prepare('SELECT owner,body FROM journal_agents WHERE id=?').get(agent.id);
      if (legacy && legacy.owner !== agent.controller || priorAgent && priorAgent.body !== canonical(agent)) {
        throw new Error('Public agent identity cannot be changed.');
      }
      const now = this.now();
      if (!priorAgent) this.db.prepare('INSERT INTO journal_agents VALUES (?,?,?,?)').run(agent.id, agent.controller, canonical(agent), now);
      let head = strategy?.openingSequence ?? 0;
      if (strategy) {
        const current = this.db.prepare('SELECT agent_id,body,head FROM journal_strategies WHERE id=?').get(strategy.id);
        if (current && (current.agent_id !== agent.id || current.body !== canonical(strategy))) throw new Error('Public strategy identity cannot be changed.');
        if (current) head = Number(current.head);
        else this.db.prepare('INSERT INTO journal_strategies VALUES (?,?,?,?,?)').run(strategy.id, agent.id, canonical(strategy), head, now);
        const initialHead = head;
        const coverage = this.db.prepare('SELECT max(sequence) AS head FROM journal_valuations WHERE strategy_id=?').get(strategy.id);
        let valuedThrough = Number(coverage?.head ?? strategy.openingSequence);
        let previousSequence = events[0]?.sequence;
        for (const event of events) {
          if (event.sequence <= strategy.openingSequence || event.sequence !== previousSequence) throw new Error('Public journal events must be consecutive.');
          previousSequence++;
          const { totalPnl, ...publicEvent } = event;
          const body = canonical(publicEvent);
          if (event.sequence <= head) {
            const existing = this.db.prepare('SELECT body FROM journal_events WHERE strategy_id=? AND sequence=?').get(strategy.id, event.sequence);
            if (existing?.body !== body) throw new Error('A previously published event cannot be rewritten.');
          } else {
            if (event.sequence !== head + 1) throw new Error('Public journal is missing an earlier event.');
            this.db.prepare('INSERT INTO journal_events VALUES (?,?,?)').run(strategy.id, event.sequence, body);
            head = event.sequence;
          }
          if (totalPnl !== undefined) {
            const previous = this.db.prepare('SELECT total_pnl FROM journal_valuations WHERE strategy_id=? AND sequence=?')
              .get(strategy.id, event.sequence);
            if (previous && previous.total_pnl !== totalPnl) throw new Error('A published paper valuation cannot be rewritten.');
            if (!previous) {
              if (event.sequence !== valuedThrough + 1) throw new Error('Public paper valuations are missing an earlier event.');
              this.db.prepare('INSERT INTO journal_valuations VALUES (?,?,?)').run(strategy.id, event.sequence, totalPnl);
              valuedThrough = event.sequence;
            }
          }
        }
        for(const mark of batch.marks??[]) {
          const now=this.now(),at=Date.parse(mark.at);
          if(at>now+5000||now-at>60000) throw new Error('Live valuation arrived too late.');
          if(mark.sequence!==head) throw new Error('Live valuation belongs to an older portfolio.');
          const source=this.db.prepare('SELECT body FROM journal_events WHERE strategy_id=? AND sequence=?').get(strategy.id,mark.sequence);
          if(!source||JSON.parse(String(source.body)).sourceHash!==mark.sourceHash||at<Date.parse(JSON.parse(String(source.body)).at))
            throw new Error('Live valuation does not match the published portfolio.');
          const body=canonical(mark);
          const prior=this.db.prepare('SELECT body FROM journal_marks WHERE strategy_id=? AND at=?').get(strategy.id,mark.at);
          if(prior&&prior.body!==body) throw new Error('A live valuation cannot be rewritten.');
          this.db.prepare('INSERT OR IGNORE INTO journal_marks VALUES (?,?,?)').run(strategy.id,mark.at,body);
          this.db.prepare('DELETE FROM journal_marks WHERE strategy_id=? AND at<?').run(strategy.id,new Date(now-7*86400000).toISOString());
        }
        if (head !== initialHead) this.db.prepare('UPDATE journal_strategies SET head=?,updated=? WHERE id=?').run(head, now, strategy.id);
        if (!current || head !== initialHead) this.db.prepare('UPDATE journal_agents SET updated=? WHERE id=?').run(now, agent.id);
      }
      if (events.length||batch.marks?.length) this.db.prepare('INSERT OR IGNORE INTO journal_batches VALUES (?,?)')
        .run(publicationHash(batch).toString('hex'), canonical({ batch, key, signature }));
      this.db.exec('COMMIT');
      return { head };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  catalog(offset: number) {
    const start = integer(offset) ? offset : 0;
    const rows = this.db.prepare(`SELECT agent.body,agent.updated,
      json_extract(strategy.body,'$.vault.contractId') AS strategyVault,
      (SELECT json_object(
        'version',json_extract(strategy.body,'$.version'), 'market',json_extract(strategy.body,'$.market'),
        'hasTradingRecord',count(*) FILTER (WHERE kind IN ('model','hold','fill','blocked')) > 0,
        'decisions',count(*) FILTER (WHERE kind='model'), 'fills',count(*) FILTER (WHERE kind='fill'),
        'buys',count(*) FILTER (WHERE kind='fill' AND action='BUY'),
        'sells',count(*) FILTER (WHERE kind='fill' AND action='SELL'))
        FROM (SELECT json_extract(body,'$.kind') AS kind,json_extract(body,'$.action') AS action
          FROM journal_events WHERE strategy_id=strategy.id)) AS activity,
      strategy.id AS strategyId
      FROM journal_agents agent LEFT JOIN journal_strategies strategy ON strategy.id=(
        SELECT id FROM journal_strategies WHERE agent_id=agent.id
        ORDER BY json_extract(body,'$.version') DESC,id LIMIT 1)
      ORDER BY agent.updated DESC,agent.id LIMIT 51 OFFSET ?`).all(start);
    return {
      agents: rows.slice(0, 50).map((row): JournalListing => {
        const agent = { ...JSON.parse(String(row.body)), updatedAt: Number(row.updated) } as JournalListing;
        if (row.strategyVault) agent.strategyVault = String(row.strategyVault);
        if (row.strategyId) {
          const activity = JSON.parse(String(row.activity));
          agent.activity = { ...activity, hasTradingRecord: Boolean(activity.hasTradingRecord) };
        }
        return agent;
      }),
      nextOffset: rows.length > 50 ? start + 50 : null,
    };
  }

  page(agentId: string, strategyId?: string, before?: number): JournalPage {
    const row = this.db.prepare('SELECT body,updated FROM journal_agents WHERE id=?').get(agentId);
    if (!row) throw new Error('Public journal not found.');
    const strategies = this.db.prepare(`SELECT body,updated,head,
      (SELECT max(sequence) FROM journal_valuations WHERE strategy_id=journal_strategies.id) AS valuedThrough
      FROM journal_strategies WHERE agent_id=?`).all(agentId)
      .map(record => ({ ...JSON.parse(String(record.body)), updatedAt: Number(record.updated), head: Number(record.head),
        ...(record.valuedThrough===null ? {} : { valuedThrough: Number(record.valuedThrough) }) } as JournalPage['strategies'][number]))
      .sort((a, b) => b.version - a.version);
    const selected = strategyId ? strategies.find(strategy => strategy.id === strategyId) : strategies[0];
    if (strategyId && !selected) throw new Error('Public strategy not found.');
    const rows = selected ? this.db.prepare(`SELECT e.sequence,e.body,v.sequence AS valued,v.total_pnl
      FROM journal_events e LEFT JOIN journal_valuations v ON v.strategy_id=e.strategy_id AND v.sequence=e.sequence
      WHERE e.strategy_id=? AND e.sequence<? ORDER BY e.sequence DESC LIMIT 101`)
      .all(selected.id, before !== undefined && integer(before) ? before : Number.MAX_SAFE_INTEGER) : [];
    const page = rows.slice(0, journalBatchSize);
    const marks=selected?this.db.prepare('SELECT body FROM journal_marks WHERE strategy_id=? ORDER BY at DESC LIMIT 1800').all(selected.id):[];
    return {
      agent: { ...JSON.parse(String(row.body)), updatedAt: Number(row.updated) },
      strategies, strategyId: selected?.id ?? null,
      paperValuations: true,
      liveMarks: true,
      marks: marks.map(row=>{const {quote:_quote,...mark}=JSON.parse(String(row.body));return mark;}),
      events: page.map(event => ({ ...JSON.parse(String(event.body)), ...(event.valued===null ? {} : { totalPnl:event.total_pnl }) })),
      nextBefore: rows.length > journalBatchSize ? Number(page.at(-1)!.sequence) : null,
    };
  }
}
