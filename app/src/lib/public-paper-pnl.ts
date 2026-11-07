import type { PublicJournalEvent } from '../../../near-demo/directory/public-journal.js';

export function publicPaperPnl(events: readonly Pick<PublicJournalEvent, 'at' | 'realized' | 'totalPnl'>[]) {
  let realized = 0n;
  const observations: { at: string; equity: string }[] = [];
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    realized += BigInt(event.realized);
    if (event.totalPnl == null) continue;
    const point = { at: event.at, equity: event.totalPnl };
    if (observations.at(-1)?.at === point.at) observations[observations.length - 1] = point;
    else observations.push(point);
  }
  return { realized: String(realized), observations, latest: observations.at(-1) };
}
