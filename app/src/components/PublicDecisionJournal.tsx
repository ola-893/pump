import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { ArrowRight, Download, Fingerprint } from 'lucide-react';
import { markets, TEST_USDC } from '../../../near-demo/types';
import type { JournalPage, PublicJournalEvent } from '../../../near-demo/directory/public-journal';
import { readJournal } from '../lib/public-journal-client';
import { paperAmount } from '../lib/paper-amount';
import { publicPaperPnl } from '../lib/public-paper-pnl';
import { AgentBackLink } from './AgentCollections';
import { VaultWorkspace, type VaultRow } from './AgentVaults';
import { useNearWallet } from './NearWalletProvider';
import { strategySeedFactory } from '../lib/strategy-seed-factory-config';
import { seedVaultAccount } from '../lib/seed-vault';
import {
  EquityChart, InvestorProfile, InvestorProfileTabs, Metric, saveInvestorReport, type InvestorProfileTab,
} from './InvestorAgentDetails';

const displayTime = (value: number | string) => new Date(value).toLocaleString();

const eventLabel: Record<PublicJournalEvent['kind'], string> = {
  model: 'Model proposal', hold: 'Held the position', blocked: 'Paper order blocked',
  fill: 'Simulated fill', mark: 'Portfolio valuation', dust: 'Paper rounding adjustment',
  mandate: 'Paper session instruction', 'testnet-link': 'Testnet session update',
};

export function PublicDecisionJournal() {
  const { agentId = '' } = useParams();
  return <PublishedInvestorProfile key={agentId} agentId={agentId}/>;
}

export function PublishedInvestorProfile({agentId}: {agentId:string}) {
  const { search } = useLocation();
  const { account } = useNearWallet();
  const [page, setPage] = useState<JournalPage>();
  const [latest, setLatest] = useState<JournalPage>();
  const [strategy, setStrategy] = useState<string>();
  const [cursors, setCursors] = useState<number[]>([]);
  const [tab, setTab] = useState<InvestorProfileTab>('Overview');
  const [error, setError] = useState('');
  const before = cursors.at(-1);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await readJournal(agentId, strategy, before);
        if (!active) return;
        setPage(result);
        if (before === undefined) setLatest(result);
        setError('');
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not read this public journal.');
      }
    }
    void load();
    const refresh = setInterval(() => void load(), 15000);
    return () => { active = false; clearInterval(refresh); };
  }, [agentId, strategy, before]);

  const selectedStrategyId = strategy ?? latest?.strategyId;
  const current = latest?.strategies.find(item => item.id === selectedStrategyId);
  const market = Object.values(markets).find(pair => pair.label === current?.market);
  const quote = market ?? {quoteDecimals:0,quoteSymbol:'quote base units'};
  const format = (value:string|null) => value === null ? '—' : `${market ? paperAmount(value, market.quoteDecimals) : value} ${quote.quoteSymbol}`;
  const switchingStrategy = strategy !== undefined && strategy !== latest?.strategyId;
  const events = switchingStrategy ? [] : latest?.events ?? [];
  const liveMarks = switchingStrategy ? [] : latest?.marks ?? [];
  const lastEquity = [...events, ...liveMarks].reduce<{at:string;equity:string}|undefined>((latest, item) =>
    item.equity !== null && (!latest || item.at > latest.at) ? {at:item.at,equity:item.equity} : latest, undefined);
  const fills = events.filter(event => event.kind === 'fill');
  const decisions = events.filter(event => event.kind === 'model');
  const pnl = publicPaperPnl(events,liveMarks);
  const total = pnl.latest?.equity ?? null;
  const fundingId = `investor-vault-${agentId}`;
  const alert = error && <p role="alert" className="nd-alert">{error}</p>;

  function selectStrategy(id:string) {
    setStrategy(id);
    setPage(undefined);
    setCursors([]);
    setError('');
  }

  function selectTab(next:InvestorProfileTab) {
    setTab(next);
    if (next !== 'Trades & decisions') setCursors([]);
  }

  function exportReport() {
    if (!latest || !current || switchingStrategy) return;
    saveInvestorReport(`${latest.agent.name}-v${current.version}-investor-report.json`, {
      format:'PUMP-PUBLIC-JOURNAL-REPORT-v1', scope:'Owner-published paper events. No investor settlement or independent execution attestation.',
      agent:latest.agent, strategy:current, events:latest.events, nextBefore:latest.nextBefore,
    });
  }

  const backParams = new URLSearchParams(search);
  const fromLeaderboard = backParams.get('from') === 'leaderboard';
  backParams.delete('agent');
  backParams.delete('from');
  const backPath = fromLeaderboard ? '/evidence' : '/vaults';
  const back = <AgentBackLink to={`${backPath}${backParams.size ? '?' + backParams : ''}`}>{fromLeaderboard ? 'Back to leaderboard' : 'Back to explore agents'}</AgentBackLink>;
  if (!latest) return <>{back}{alert}{!error&&<p role="status">Loading public decisions…</p>}</>;

  const agent = latest.agent;
  const factory=strategySeedFactory;
  const binding=current?.vault;
  const vault:VaultRow|undefined = !switchingStrategy&&factory?.reporterId&&current&&binding&&
    binding.contractId===seedVaultAccount(agent.controller,current.id,factory.id)?{
      ...binding,agentId,runId:current.id,version:current.version,name:agent.name,network:'testnet',mode:'journal-nav',
      controllerId:agent.controller,reporterId:factory.reporterId,tokenId:TEST_USDC,liveNav:true,
      archived:latest.strategies[0]?.id!==current.id,
    }:undefined;
  const selectedPage = !switchingStrategy && page?.strategyId === latest.strategyId ? page : undefined;
  const subset = latest.nextBefore !== null ? 'Latest 100 published events' : 'Published events';
  return <>
    <div className="ag-detail-top">{back}<span className="ag-detail-creator">Created by {agent.controller}</span></div>
    <InvestorProfile name={agent.name}
      identity={<div className="ip-identity">
        <div className="ip-identity-main">
          <span className="ip-avatar"><Fingerprint size={28}/></span>
          <div><div className="nd-eyebrow">LOCAL MODEL{current&&` · ${current.market}`}</div>
            <h2>{agent.name}<span className="nd-pill">Public agent</span></h2>
            <p>{agent.model} <span>· Self-hosted inference</span></p>
          </div>
        </div>
        <div className="nd-buttons">
          <button className="nd-button secondary" type="button" onClick={()=>selectTab('Model & evidence')}>Agent identity</button>
          <a className="nd-button" href={`#${fundingId}`}>{switchingStrategy?'View investment status':vault?(vault.archived?'Withdraw':'Invest'):'Investment pending'} <ArrowRight size={14}/></a>
        </div>
      </div>}
      investment={vault?<VaultWorkspace key={vault.contractId+account} fundingId={fundingId} v={vault} account={account} api={publicVaultRequest} refresh={async()=>{}}/>:<section className="nd-card av-invest-cta ag-switch-note" id={fundingId} aria-label="Investment availability">
        <div className="nd-eyebrow">NEAR TESTNET</div>
        {switchingStrategy ? <h2 role="status">{error ? 'Could not check investment availability.' : 'Checking investment availability…'}</h2> : <>
          <h2>Investments are not open yet.</h2>
          <p>{current ? `Strategy v${current.version} has no investment vault linked to this profile.` : 'This agent has no published strategy to invest in.'} Each investable strategy version has its own vault and pump coin.</p>
        </>}
      </section>}>
      <div className="ip-version">
        <div>{current ? <label>Strategy record
          <select value={strategy ?? current.id} onChange={event=>selectStrategy(event.target.value)}>
            {latest.strategies.map(item=><option key={item.id} value={item.id}>v{item.version} · {item.market}</option>)}
          </select>
        </label> : <strong>No strategy record yet</strong>}
        <p>Last synced {displayTime(current?.updatedAt ?? agent.updatedAt)}</p></div>
        <div className="ip-scope"><span className="nd-pill">Paper performance</span><small>Each version has its own published record.</small></div>
      </div>
      <InvestorProfileTabs selected={tab} onSelect={selectTab}/>
      {alert}
      {tab==='Overview'&&<>
        <div className="ip-overview">
          <section className="nd-card ip-performance">
            <div className="ip-card-top"><div>
              <div className="nd-eyebrow">TOTAL PAPER P&L · {quote.quoteSymbol}</div>
              <div className={`ip-equity ${BigInt(total??0)<0n?'negative':BigInt(total??0)>0n?'positive':''}`}>{format(total)}</div>
              <p>{pnl.latest?`Realized and unrealized · As of ${displayTime(pnl.latest.at)}`:'Valuations appear when the owner syncs this strategy’s journal.'}</p>
            </div></div>
            <EquityChart key={current?.id} market={quote} observations={pnl.observations} initial="0" variant="pnl" loading={switchingStrategy}/>
            <div className="ip-stat-row">
              <Metric label={`Paper equity · ${quote.quoteSymbol}`} value={paperAmount(lastEquity?.equity,quote.quoteDecimals)} hint={lastEquity?`Includes capital · ${displayTime(lastEquity.at)}`:'Includes capital'}/>
              <Metric label={`Realized P&L · ${quote.quoteSymbol}`} value={events.length?paperAmount(pnl.realized,quote.quoteDecimals):'—'} hint={subset}/>
              <Metric label="Filled orders" value={switchingStrategy?'—':String(fills.length)} hint={subset}/>
            </div>
          </section>
          <aside className="nd-card ip-at-glance">
            <div className="nd-eyebrow">AT A GLANCE</div><h3>The record behind the return.</h3>
            <div className="ip-counts">
              <Metric label="HOLD outcomes" value={switchingStrategy?'—':String(events.filter(event=>event.kind==='hold').length)}/>
              <Metric label="Blocked attempts" value={switchingStrategy?'—':String(events.filter(event=>event.kind==='blocked').length)}/>
              <Metric label="Model decisions" value={switchingStrategy?'—':String(decisions.length)} hint={subset}/>
            </div>
            <div className="ip-latest"><small>Latest recorded model decision</small><strong>{switchingStrategy?'—':decisions[0]?.action ?? 'No decision yet'}</strong>
              {decisions[0]&&<p>{displayTime(decisions[0].at)}</p>}
            </div>
          </aside>
        </div>
        <div className="ip-section-head"><div><div className="nd-eyebrow">RECENT EXECUTION</div><h3>See how decisions became positions.</h3></div>
          <button className="nd-text-button" onClick={()=>selectTab('Trades & decisions')}>All trades & decisions <ArrowRight size={13}/></button>
        </div>
        <JournalEvents events={fills.slice(0,5)} format={format} empty={switchingStrategy?'Loading published fills…':'No filled orders in the published events.'}/>
        {latest.strategies.length>0&&<section className="nd-card ip-versions">
          <div className="nd-eyebrow">STRATEGY HISTORY</div><h3>A version change never inherits an old return.</h3>
          <div className="nd-table-wrap"><table><thead><tr><th>Version</th><th>Last synced</th><th>Record</th></tr></thead>
            <tbody>{latest.strategies.map(item=><tr key={item.id}>
              <td>v{item.version} · {item.market}</td><td>{displayTime(item.updatedAt)}</td>
              <td><button className="nd-text-button" disabled={item.id===(strategy??current?.id)} onClick={()=>selectStrategy(item.id)}>{item.id===(strategy??current?.id)?'Selected':'Inspect version'}</button></td>
            </tr>)}</tbody></table></div>
        </section>}
      </>}
      {tab==='Trades & decisions'&&<section className="ip-trades" aria-label="Public decision journal">
        <div className="ip-section-head"><div><div className="nd-eyebrow">TRADING ACTIVITY</div><h3>Orders, decisions and quote receipts.</h3></div>
          <button className="nd-button secondary" disabled={!current||switchingStrategy} onClick={exportReport}><Download size={14}/>Export investor report</button>
        </div>
        <JournalEvents events={selectedPage?.events ?? []} format={format} empty={selectedPage?'No decisions have been published for this view yet.':'Loading published decisions…'}/>
        <div className="ip-pagination"><span>Page {cursors.length+1}</span><div>
          <button type="button" className="nd-text-button" disabled={!cursors.length} onClick={()=>{setPage(undefined);setCursors(cursors.slice(0,-1));}}>Newer events</button>
          <button type="button" className="nd-text-button" disabled={selectedPage?.nextBefore==null} onClick={()=>{
            if (selectedPage?.nextBefore!=null) { setPage(undefined);setCursors([...cursors,selectedPage.nextBefore]); }
          }}>Older events</button>
        </div></div>
      </section>}
      {tab==='Strategy & risk'&&<div className="ip-lower">
        <section className="nd-card ip-risk"><div className="nd-eyebrow">PUBLIC STRATEGY</div><h3>{current?`v${current.version} · ${current.market}`:'No strategy record yet'}</h3>
          <p>The owner publishes decision outcomes. Strategy instructions and risk settings stay in the owner’s workspace.</p></section>
        <section className="nd-card ip-risk"><div className="nd-eyebrow">BEFORE ALLOCATING</div><h3>Understand what this record measures.</h3>
          <p>Paper fills are simulated. The published record covers the events shared by the owner and does not represent investor returns.</p></section>
      </div>}
      {tab==='Model & evidence'&&<div className="ip-lower">
        <section className="nd-card ip-risk"><div className="nd-eyebrow">MODEL IDENTITY</div><h3>{agent.model}</h3><dl><div><dt>Controller declaration</dt><dd>{agent.controller}</dd></div><div><dt>Inference</dt><dd>Self-hosted</dd></div></dl></section>
        <section className="nd-card ip-risk"><div className="nd-eyebrow">PROVENANCE</div><h3>Trace the selected record.</h3>
          <p>The public journal includes event hashes and signed quote references when available.</p>
          <button className="nd-button secondary" disabled={!current||switchingStrategy} onClick={exportReport}><Download size={14}/>Export investor report</button>
        </section>
      </div>}
      <p className="ip-footnote">Paper performance and testnet vault balances are separate records.</p>
    </InvestorProfile>
  </>;
}

function JournalEvents({events,format,empty}:{events:PublicJournalEvent[];format:(value:string|null)=>string;empty:string}) {
  return <div className="nd-card ip-activity">
    {events.length===0 ? <div className="ip-empty"><h3>{empty}</h3></div> :
      <div className="nd-table-wrap"><table><thead><tr><th>Time / event</th><th>Outcome</th><th>Paper portfolio</th><th>Evidence</th></tr></thead>
        <tbody>{events.map(event=><tr key={event.sequence}>
          <td>{displayTime(event.at)} · #{event.sequence}</td>
          <td>{eventLabel[event.kind]}{event.action&&` · ${event.action}`}</td>
          <td>Equity {format(event.equity)}<small>Realized change {format(event.realized)}</small></td>
          <td><details><summary>Inspect evidence</summary><p>Local event hash {event.sourceHash}</p>
            {event.receipt&&<><p>Quote ID {event.receipt.id}</p><p>Observed {displayTime(event.receipt.observedAt)}</p>
              <p>{event.receipt.amountIn} in · {event.receipt.amountOut} out (base units)</p></>}
          </details></td>
        </tr>)}</tbody></table></div>}
  </div>;
}

async function publicVaultRequest(path:string,body?:unknown) {
  const response=await fetch('/api/near-demo/public-'+path.slice(1),{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  });
  const result=await response.json();
  if (!response.ok) throw new Error(result.error??'Could not verify the strategy vault.');
  return result;
}
