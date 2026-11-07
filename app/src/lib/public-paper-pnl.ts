import type { PublicJournalEvent } from '../../../near-demo/directory/public-journal.js';

export function publicPaperPnl(events: readonly Pick<PublicJournalEvent, 'at' | 'realized'>[]) {
  let total = 0n;
  const observations: { at: string; equity: string }[] = [];
  // The journal is newest first. A deposit can change equity without changing realized P&L.
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    const change = BigInt(event.realized);
    total += change;
    if (observations.length && index !== 0 && change === 0n) continue;
    const point = { at: event.at, equity: String(total) };
    if (observations.at(-1)?.at === point.at) observations[observations.length - 1] = point;
    else observations.push(point);
  }
  return { total: String(total), observations };
}
