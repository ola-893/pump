import type { JournalMark, PublicJournalEvent } from '../../../near-demo/directory/public-journal.js';

export function publicPaperPnl(events: readonly Pick<PublicJournalEvent, 'at' | 'realized' | 'totalPnl'>[], marks:readonly Pick<JournalMark,'at'|'totalPnl'>[] = []) {
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
  observations.push(...marks.map(mark=>({at:mark.at,equity:mark.totalPnl})));
  observations.sort((a,b)=>a.at.localeCompare(b.at));
  for(let i=observations.length-1;i>0;i--) {
    if(observations[i].at===observations[i-1].at)observations.splice(i-1,1);
  }
  return { realized: String(realized), observations, latest: observations.at(-1) };
}
