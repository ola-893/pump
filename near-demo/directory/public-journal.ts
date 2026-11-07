import type { Event } from '../types.js';

export const journalSchema = 'PUMP-PUBLIC-JOURNAL-v1';
export const journalBatchSize = 100;
export type PublicJournalEvent = {
  sequence: number;
  at: string;
  kind: Event['kind'];
  action: 'BUY' | 'SELL' | 'HOLD' | null;
  receipt: { id: string; observedAt: string; amountIn: string; amountOut: string } | null;
  equity: string | null;
  realized: string;
  totalPnl?: string | null;
  sourceHash: string;
};
export type JournalAgent = { id: string; name: string; model: string; controller: string };
export type JournalStrategy = { id: string; version: number; market: string; openingSequence: number;
  vault?: { contractId:string; manifestHash:string; strategyHash:string; seedAmount:string; seedReceipt:string } };
export type JournalBatch = {
  schema: typeof journalSchema;
  agent: JournalAgent;
  strategy: JournalStrategy | null;
  events: PublicJournalEvent[];
};
export type JournalActivity = { version: number; market: string; hasTradingRecord: boolean;
  decisions: number; fills: number; buys: number; sells: number };
export type JournalListing = JournalAgent & { updatedAt: number; strategyVault?: string; activity?: JournalActivity };
export type JournalPage = {
  agent: JournalListing;
  strategies: (JournalStrategy & { updatedAt: number; head: number; valuedThrough?: number })[];
  paperValuations?: true;
  strategyId: string | null;
  events: PublicJournalEvent[];
  nextBefore: number | null;
};

export function paperPnlAt(event: Event, initialCash: string): bigint | null {
  const { after } = event;
  if (after.equity === null) return null;
  if (after.position !== '0' && (event.kind !== 'mark' || !event.quote?.signatureVerified)) return null;
  return BigInt(after.equity) - BigInt(after.vaultCapital?.assets ?? initialCash);
}

export function publicJournalEvent(event: Event): PublicJournalEvent {
  return {
    sequence: event.sequence, at: event.at, kind: event.kind,
    action: event.action ?? event.model?.proposal.action ?? (event.kind === 'hold' ? 'HOLD' : null),
    receipt: event.quote?.signatureVerified ? {
      id: event.quote.id, observedAt: event.quote.observedAt,
      amountIn: event.quote.amountIn, amountOut: event.quote.amountOut,
    } : null,
    equity: event.after.equity,
    realized: String(BigInt(event.after.realized) - BigInt(event.before.realized)),
    sourceHash: event.hash,
  };
}
