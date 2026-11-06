import type { DatabaseSync } from 'node:sqlite';
import { canonical } from '../paper-state.js';
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
  if (!keys(batch, 'agent,events,schema,strategy') || batch.schema !== journalSchema ||
    !keys(batch.agent, 'controller,id,model,name') || !uuid(batch.agent.id) || !text(batch.agent.name, 64) ||
    !text(batch.agent.model, 128) || !Array.isArray(batch.events) || batch.events.length > journalBatchSize) {
    throw new Error('Invalid public journal batch.');
  }
  testAccount(batch.agent.controller);
  if (batch.strategy === null && batch.events.length === 0) return;
  const strategy = batch.strategy;
  if (!strategy || !keys(strategy, 'id,market,openingSequence,version') || !uuid(strategy.id) ||
    !text(strategy.market, 80) || !integer(strategy.openingSequence) || !integer(strategy.version) || strategy.version < 1) {
    throw new Error('Invalid public strategy identity.');
  }
  for (const event of batch.events) {
    if (!keys(event, 'action,at,equity,kind,realized,receipt,sequence,sourceHash') || !integer(event.sequence) ||
      !date(event.at) || !eventKinds.includes(event.kind) || ![null, 'BUY', 'SELL', 'HOLD'].includes(event.action) ||
      !hash(event.sourceHash) || event.equity !== null && !amount(event.equity) || !amount(event.realized)) {
      throw new Error('Invalid public decision event.');
    }
    const receipt = event.receipt;
    if (receipt !== null && (!keys(receipt, 'amountIn,amountOut,id,observedAt') ||
      !hash(receipt.id) || !date(receipt.observedAt) || !amount(receipt.amountIn) || !amount(receipt.amountOut))) {
      throw new Error('Invalid public quote receipt.');
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
        let previousSequence = events[0]?.sequence;
        for (const event of events) {
          if (event.sequence <= strategy.openingSequence || event.sequence !== previousSequence) throw new Error('Public journal events must be consecutive.');
          previousSequence++;
          const body = canonical(event);
          if (event.sequence <= head) {
            const existing = this.db.prepare('SELECT body FROM journal_events WHERE strategy_id=? AND sequence=?').get(strategy.id, event.sequence);
            if (existing?.body !== body) throw new Error('A previously published event cannot be rewritten.');
          } else {
            if (event.sequence !== head + 1) throw new Error('Public journal is missing an earlier event.');
            this.db.prepare('INSERT INTO journal_events VALUES (?,?,?)').run(strategy.id, event.sequence, body);
            head = event.sequence;
          }
        }
        if (head !== initialHead) this.db.prepare('UPDATE journal_strategies SET head=?,updated=? WHERE id=?').run(head, now, strategy.id);
        if (!current || head !== initialHead) this.db.prepare('UPDATE journal_agents SET updated=? WHERE id=?').run(now, agent.id);
      }
      if (events.length) this.db.prepare('INSERT OR IGNORE INTO journal_batches VALUES (?,?)')
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
    const rows = this.db.prepare('SELECT body,updated FROM journal_agents ORDER BY updated DESC,id LIMIT 51 OFFSET ?').all(start);
    return {
      agents: rows.slice(0, 50).map(row => ({ ...JSON.parse(String(row.body)), updatedAt: Number(row.updated) } as JournalListing)),
      nextOffset: rows.length > 50 ? start + 50 : null,
    };
  }

  page(agentId: string, strategyId?: string, before?: number): JournalPage {
    const row = this.db.prepare('SELECT body,updated FROM journal_agents WHERE id=?').get(agentId);
    if (!row) throw new Error('Public journal not found.');
    const strategies = this.db.prepare('SELECT body,updated,head FROM journal_strategies WHERE agent_id=?').all(agentId)
      .map(record => ({ ...JSON.parse(String(record.body)), updatedAt: Number(record.updated), head: Number(record.head) } as JournalPage['strategies'][number]))
      .sort((a, b) => b.version - a.version);
    const selected = strategyId ? strategies.find(strategy => strategy.id === strategyId) : strategies[0];
    if (strategyId && !selected) throw new Error('Public strategy not found.');
    const rows = selected ? this.db.prepare('SELECT sequence,body FROM journal_events WHERE strategy_id=? AND sequence<? ORDER BY sequence DESC LIMIT 101')
      .all(selected.id, before !== undefined && integer(before) ? before : Number.MAX_SAFE_INTEGER) : [];
    const page = rows.slice(0, journalBatchSize);
    return {
      agent: { ...JSON.parse(String(row.body)), updatedAt: Number(row.updated) },
      strategies, strategyId: selected?.id ?? null,
      events: page.map(event => JSON.parse(String(event.body))),
      nextBefore: rows.length > journalBatchSize ? Number(page.at(-1)!.sequence) : null,
    };
  }
}
