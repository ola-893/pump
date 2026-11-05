import { paperMarket, type Event, type Session } from '../../../near-demo/types.js';

export type EquityObservation = { at: string; sequence: number; equity: string | null };
export type InvestorEvent = {
  at: string; sequence: number; hash: string; kind: 'model' | 'fill' | 'blocked' | 'dust';
  operatorDirected?: boolean; action?: string; reason: string; notional: string | null; near: string | null;
  realized: string | null; quote: { id: string; signed: boolean; observedAt: string; receivedAt: string; source: string } | null;
};
export type ClosedPosition = { openedAt: string; closedAt: string; pnl: string; entry: string };
export type AgentPerformance = {
  sessionId: string; sequence: number; head: string | null; createdAt: string; initialCash: string;
  quoteCurrency?:{symbol:string;decimals:number};
  recordedPortfolio: Pick<Session['portfolio'], 'cash' | 'position' | 'cost' | 'realized' | 'equity' | 'markAt'>;
  firstDecision: string | null; lastDecision: string | null; activeDays: number;
  observations: EquityObservation[]; activity: InvestorEvent[]; closed: ClosedPosition[];
  operatorExits?: number; wins: number; losses: number; breakeven: number; signedFills: number; fills: number;
};
const safeReason = (s: string) => s.replace(/\/(?:Users|private|var)\/[^\s]+/g, '[local path]');

// The server calls this with its verified strategy export; public clients receive only the derived report.
// Keep the investor report free of raw prompts, responses, private strategy and paths.
export function investorPerformance(session: Session, events: Event[]): AgentPerformance {
  if (!session.agent?.strategyRunId || session.exercise || session.testnet) throw new Error('Select an independent strategy portfolio.');
  if (events.some(e => e.sessionId !== session.id || e.kind === 'mandate' || e.exerciseId || e.exercise || ['manual-scenario', 'operator-directed-model', 'operator-mandate'].includes(e.evidence))) throw new Error('Execution practice cannot be mixed into strategy performance.');
  const activity: InvestorEvent[] = [], closed: ClosedPosition[] = [];
  const observations: EquityObservation[] = [{ at: session.createdAt, sequence: 0, equity: session.config.initialCash }];
  const decisions = events.filter(e => e.kind === 'model' && e.evidence === 'live-local-model');
  let openedAt: string | null = null, entry = 0n, pnl = 0n, signedFills = 0, fills = 0;
  for (const e of events) {
    if (e.kind === 'mark' || e.kind === 'dust') observations.push({ at: e.at, sequence: e.sequence, equity: e.after.equity });
    if(e.kind==='dust'){
      const loss=BigInt(e.after.realized)-BigInt(e.before.realized);
      activity.push({at:e.at,sequence:e.sequence,hash:e.hash,kind:'dust',reason:safeReason(e.reason),notional:null,near:null,realized:String(loss),quote:null});
      pnl+=loss;
      if(openedAt&&e.after.position==='0'){closed.push({openedAt,closedAt:e.at,pnl:String(pnl),entry:String(entry)});openedAt=null;entry=0n;pnl=0n;}
      continue;
    }
    if (!['model', 'fill', 'blocked'].includes(e.kind)) continue;
    if (e.kind !== 'blocked' && e.evidence !== 'live-local-model' && !(e.kind==='fill'&&e.evidence==='operator-exit'&&e.action==='SELL'&&e.operatorExit)) throw new Error('Unsupported strategy evidence.');
    const q = e.quote;
    if (e.kind === 'fill' && (!q || q.source !== 'live' || !e.action)) throw new Error('Strategy fill has no live quote.');
    const realized = e.kind === 'fill' && e.action === 'SELL' ? String(BigInt(e.after.realized) - BigInt(e.before.realized)) : null;
    activity.push({ at: e.at, sequence: e.sequence, hash: e.hash, kind: e.kind as InvestorEvent['kind'], operatorDirected:e.evidence==='operator-exit',
      action: e.kind === 'model' ? e.model?.proposal.action : e.action, reason: safeReason(e.reason),
      notional: e.kind === 'fill' && q ? e.action === 'BUY' ? q.amountIn : q.amountOut : null,
      near: e.kind === 'fill' && q ? e.action === 'BUY' ? q.amountOut : q.amountIn : null,
      realized, quote: q ? { id: q.id, signed: q.signatureVerified, observedAt: q.observedAt, receivedAt: q.receivedAt, source: q.source } : null });
    if (e.kind !== 'fill') continue;
    ++fills; if (q!.signatureVerified) ++signedFills;
    if (e.action === 'BUY') {
      if (e.before.position === '0') { openedAt = e.at; entry = 0n; pnl = 0n; }
      entry += BigInt(q!.amountIn);
    } else {
      pnl += BigInt(realized!);
      if (e.after.position === '0' && openedAt) {
        closed.push({ openedAt, closedAt: e.at, pnl: String(pnl), entry: String(entry) });
        openedAt = null; entry = 0n; pnl = 0n;
      }
    }
  }
  const market=paperMarket(session.config);
  return {quoteCurrency:{symbol:market.quoteSymbol,decimals:market.quoteDecimals},sessionId: session.id, sequence: session.sequence, head: session.head, createdAt: session.createdAt, initialCash: session.config.initialCash,
    recordedPortfolio: { cash: session.portfolio.cash, position: session.portfolio.position, cost: session.portfolio.cost, realized: session.portfolio.realized, equity: session.portfolio.equity, markAt: session.portfolio.markAt },
    firstDecision: decisions[0]?.at ?? null, lastDecision: decisions.at(-1)?.at ?? null,
    activeDays: new Set(decisions.map(e => e.at.slice(0,10))).size, observations, activity: activity.reverse(), closed,
    operatorExits: events.filter(e=>e.kind==='fill'&&e.evidence==='operator-exit').length,
    wins: closed.filter(c => BigInt(c.pnl) > 0n).length, losses: closed.filter(c => BigInt(c.pnl) < 0n).length,
    breakeven: closed.filter(c => c.pnl === '0').length, signedFills, fills };
}
