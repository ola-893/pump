import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { JournalPage, PublicJournalEvent } from '../../../near-demo/directory/public-journal';
import { readJournal } from '../lib/public-journal-client';

const displayTime = (value: number | string) => new Date(value).toLocaleString();

const eventLabel: Record<PublicJournalEvent['kind'], string> = {
  model: 'Model proposal', hold: 'Held the position', blocked: 'Paper order blocked',
  fill: 'Simulated fill', mark: 'Portfolio valuation', dust: 'Paper rounding adjustment',
  mandate: 'Paper session instruction', 'testnet-link': 'Testnet session update',
};

export function PublicDecisionJournal() {
  const { agentId = '' } = useParams();
  const { search } = useLocation();
  const [page, setPage] = useState<JournalPage>();
  const [strategy, setStrategy] = useState<string>();
  const [cursors, setCursors] = useState<number[]>([]);
  const [error, setError] = useState('');
  const before = cursors.at(-1);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await readJournal(agentId, strategy, before);
        if (active) { setPage(result); setError(''); }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not read this public journal.');
      }
    }
    setPage(undefined);
    void load();
    const refresh = setInterval(() => void load(), 15000);
    return () => { active = false; clearInterval(refresh); };
  }, [agentId, strategy, before]);
  const current = page?.strategies.find(item => item.id === page.strategyId);
  return <>
    <Link className="nd-text-button" to={{pathname:'/vaults',search}}>Back to explore agents</Link>
    <div className="nd-title"><div><h1>{page?.agent.name ?? 'Public decision journal'}</h1>
      {page && <p>{page.agent.model} · {page.agent.controller}</p>}</div></div>
    {error && <p role="alert" className="nd-alert">{error}</p>}
    {!page && !error && <p role="status">Loading public decisions…</p>}
    {page && <section className="nd-card na-detail" aria-label="Public decision journal">
      <h2>Public decision journal</h2>
      <p className="na-note">Last synced {displayTime(current?.updatedAt ?? page.agent.updatedAt)}. Owner-authorized record of paper trading.</p>
      {page.strategies.length > 0 && <label>Strategy version
        <select value={page.strategyId ?? ''} onChange={event => { setStrategy(event.target.value); setCursors([]); }}>
          {page.strategies.map(item => <option key={item.id} value={item.id}>v{item.version} · {item.market}</option>)}
        </select></label>}
      {page.events.length === 0 ? <p>No decisions have been published for this view yet.</p> :
        <div className="nd-table-wrap"><table><thead><tr><th>Time</th><th>Outcome</th><th>Paper portfolio</th><th>Evidence</th></tr></thead>
          <tbody>{page.events.map(event => <tr key={event.sequence}>
            <td>{displayTime(event.at)} · #{event.sequence}</td>
            <td>{eventLabel[event.kind]}{event.action && ` · ${event.action}`}</td>
            <td>Equity {event.equity ?? '—'} · Realized change {event.realized} <small>(quote base units)</small></td>
            <td><details><summary>Inspect evidence</summary><p>Local event hash {event.sourceHash}</p>
              {event.receipt && <><p>Quote ID {event.receipt.id}</p><p>Observed {displayTime(event.receipt.observedAt)}</p>
                <p>{event.receipt.amountIn} in · {event.receipt.amountOut} out (base units)</p></>}</details></td>
          </tr>)}</tbody></table></div>}
      <div className="nd-buttons">
        <button type="button" className="nd-button secondary" disabled={!cursors.length} onClick={() => setCursors(cursors.slice(0, -1))}>Newer events</button>
        <button type="button" className="nd-button secondary" disabled={page.nextBefore === null} onClick={() => {
          if (page.nextBefore !== null) setCursors([...cursors, page.nextBefore]);
        }}>Older events</button>
      </div>
    </section>}
  </>;
}
