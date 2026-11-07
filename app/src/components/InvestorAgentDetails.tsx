import { paperAmount } from '../lib/paper-amount';
import { paperMarket } from '../../../near-demo/types';
import { paperValuation } from '../lib/paper-valuation';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, Cpu, Download, Fingerprint, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AgentManifest } from '../../../near-demo/public-types';
import type { ConsoleRun } from './AgentConsole';
import { type AgentPerformance, type EquityObservation } from '../lib/agent-performance';
import './InvestorAgentDetails.css';

export type InvestorAgent = { visibility?:'private'|'public'; id: string; createdAt: string; manifest: AgentManifest; commitment: string };
type Props = { agent: InvestorAgent; runs: ConsoleRun[]; run?: ConsoleRun; onSelectRun: (id:string)=>void; api: (path: string, body?: unknown) => Promise<any>; fundingId: string; investment: ReactNode; investmentReady: boolean; archived?:boolean };
const pct = (n: number | null | undefined) => n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const stamp = (s: string) => new Date(s).toLocaleString();
const shortDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export function saveInvestorReport(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function InvestorAgentDetails({ agent, runs, run, onSelectRun, api, fundingId, investment, investmentReady, archived }: Props) {
  const versions = [...runs].sort((a,b) => b.version - a.version);
  const [tab,setTab] = useState<InvestorProfileTab>('Overview'), [report,setReport] = useState<{ runId: string; data: AgentPerformance; checkedAt: string }>(), [error,setError] = useState(''), [busy,setBusy] = useState(false), [reload,setReload] = useState(0);
  const apiRef = useRef(api); apiRef.current = api;
  useEffect(() => {
    let active = true;
    if (!run) return;
    setBusy(true); setError('');
    void apiRef.current('/strategy-report', { runId: run.id }).then(d => {
      const data = d.report as AgentPerformance;
      if (active) setReport({ runId: run.id, data, checkedAt: new Date().toISOString() });
    }).catch(e => { if (active) { setReport(undefined); setError(e.message); } }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [run?.id, run?.session.sequence, reload]);
  const current = report?.runId === run?.id ? report : undefined, data = current?.data;
  const p = run?.session.portfolio;
  const valuation=run?paperValuation(run.session,run.config.initialCash):null;
  const market = paperMarket(run?.config),currency=market.quoteSymbol;
  const cash=(value:string|null|undefined)=>paperAmount(value,market.quoteDecimals);
  const signed=(value:string|null|undefined)=>value!=null&&BigInt(value)>0n?'+'+cash(value):cash(value);
  const total = valuation?.total??null;
  const returnPct = total != null && run ? Number(total) * 100 / Number(run.config.initialCash) : null;
  const allocated = run && p ? Number(p.cost) * 100 / Number(run.config.initialCash) : 0;
  const exportReport = () => { if (current && run) saveInvestorReport(`${agent.manifest.name}-v${run.version}-investor-report.json`, {
    format: 'PUMP-INVESTOR-REPORT-v1', mode: 'paper trading; not settled investor returns', agent: { id: agent.id, name: agent.manifest.name, model: agent.manifest.model, registrationCommitment: agent.commitment },
    strategy: { id: run.id, version: run.version, label: run.label, commitment: run.commitment }, checkedAt: current.checkedAt,
    report: current.data, scope: 'Server checked local hash-chain/accounting and strategy binding. No independent model attestation. Raw prompts and private strategy text omitted. Network gas and setup costs excluded.'
  }); };
  return <InvestorProfile name={agent.manifest.name} investment={investment} identity={
    <div className="ip-identity"><div className="ip-identity-main"><span className="ip-avatar"><Fingerprint size={28}/></span><div><div className="nd-eyebrow">LOCAL MODEL · {market.label}</div><h2>{agent.manifest.name}<span className="nd-pill">{run?.session.state === 'running' ? 'Trading enabled' : 'Worker stopped'}</span></h2><p>{agent.manifest.model.id} <span>· {agent.manifest.model.quantization} · Self-hosted inference</span></p></div></div><div className="nd-buttons"><Link className="nd-button secondary" to={`/agents/${agent.id}`}>Agent identity <ArrowUpRight size={14}/></Link><a className="nd-button" href={`#${fundingId}`}>{investmentReady?(archived?'Withdraw':'Invest'):archived?'No vault for this version':'Investment pending'} <ArrowRight size={14}/></a></div></div>}>
    <div className="ip-version"><div>{run ? <label>Strategy record<select value={run.id} onChange={e => onSelectRun(e.target.value)}>{versions.map(r => <option key={r.id} value={r.id}>v{r.version} · {r.label}{r.archived?' · Archived':''}</option>)}</select></label> : <strong>No strategy record yet</strong>}<p>{run ? `Started ${shortDate(run.createdAt)} · ${cash(run.config.initialCash)} virtual ${currency} · ${run.id === versions[0].id ? 'Latest version' : 'Historical version'}` : 'This agent has an identity, but has not saved an independent trading strategy.'}</p></div><div className="ip-scope"><span className="nd-pill">Paper performance</span><small>Each version has its own portfolio. Earlier execution exercises are excluded.</small></div></div>
    {!run ? <div className="nd-card ip-empty"><Cpu size={25}/><h3>Let the agent build a record.</h3><p>Trading performance appears after the operator saves and runs a strategy. Registration and a vault address alone are not trading results.</p><Link className="nd-button secondary" to={`/console?agent=${agent.id}`}>Open agent console <ArrowRight size={14}/></Link></div> : <>
      <InvestorProfileTabs selected={tab} onSelect={setTab}/>
      {error && <p className="nd-alert" role="alert">Could not verify this strategy journal: {error} <button className="nd-text-button" onClick={() => setReload(n => n+1)}>Retry</button></p>}
      {tab === 'Overview' && <><div className="ip-overview"><section className="nd-card ip-performance"><div className="ip-card-top"><div><div className="nd-eyebrow">{valuation?.stale?`LAST QUOTED STRATEGY EQUITY · ${currency}`:`STRATEGY EQUITY · ${currency}`}</div><div className="ip-equity">{cash(valuation?.equity)}<span className={total != null && BigInt(total) < 0n ? 'negative' : 'positive'}>{pct(returnPct)}</span></div><p>{total == null ? 'No quoted paper equity available yet. The chart shows recorded valuations.' : `${signed(total)} ${currency} since this strategy version started`}</p></div><button type="button" className="nd-icon" aria-label="Refresh paper performance record" title="Refresh paper performance record" disabled={busy} onClick={() => setReload(n => n+1)}><RefreshCw size={15}/></button></div>
        <EquityChart market={market} observations={data?.observations ?? []} initial={run.config.initialCash} gapMs={Math.max(180000,run.config.intervalMs*3)} loading={busy && !data}/>
        <div className="ip-chart-caption"><span>{valuation?`${valuation.stale?'Last quote':'Valuation'} ${stamp(valuation.at)}`:'No quoted valuation yet'}</span><span>{data ? `${data.observations.length} recorded observations` : busy ? 'Checking journal…' : 'Observations unavailable'}</span></div>
        <div className="ip-stat-row"><Metric label="Observed max drawdown" value={`${((p?.maxDrawdownBps ?? 0)/100).toFixed(2)}%`} hint="From recorded equity marks"/><Metric label="Closed-position win rate" value={data?.closed.length ? `${(data.wins*100/data.closed.length).toFixed(1)}%` : '—'} hint={data ? `${data.wins} wins · ${data.losses} losses · ${data.breakeven} breakeven` : 'Waiting for verified journal'}/><Metric label="Closed positions" value={data ? String(data.closed.length) : '—'} hint="Counted after inventory returns to zero"/></div>
      </section><aside className="nd-card ip-at-glance"><div className="nd-eyebrow">AT A GLANCE</div><h3>The record behind the return.</h3><div className="ip-counts"><Metric label="Filled orders" value={String(run.activity.fills)} hint={`${run.activity.buys} buys · ${run.activity.sells} sells`}/><Metric label="Trading volume" value={`${cash(run.activity.volume)}`} hint={`Gross ${currency} across both sides`}/><Metric label="Model decisions" value={String(run.activity.decisions)} hint={`${run.activity.holds} HOLDs · ${run.activity.blocked} blocked attempts`}/><Metric label="Decision days" value={data ? String(data.activeDays) : '—'} hint="Distinct UTC days with model decisions"/></div><div className="ip-sample"><span className="ip-dot"/><p>{!data ? 'Waiting for the verified journal before assessing completed positions.' : data.closed.length ? `${data.closed.length} closed position${data.closed.length === 1 ? '' : 's'} in this record. Review individual exits alongside the headline return.` : 'No completed positions yet. An open position has not established an exit outcome.'}</p></div><div className="ip-latest"><small>Latest recorded model decision {run.activity.latest ? `· ${stamp(run.activity.latest.at)}` : ''}</small><strong>{run.activity.latest?.proposal?.action ?? 'No decision yet'}</strong>{run.activity.latest?.proposal&&<small>Model rationale · may contain errors</small>}<p>{run.activity.latest?.proposal?.reason ?? 'The operator has not recorded a model evaluation for this version.'}</p></div>{run.session.error && <p className="ip-cycle-error">Latest blocked attempt: {run.session.error}</p>}</aside></div>
      <div className="ip-lower"><section className="nd-card ip-portfolio"><div className="nd-eyebrow">CURRENT PAPER PORTFOLIO</div><h3>Where the virtual capital sits.</h3><div className="ip-allocation" role="img" aria-label={`${allocated.toFixed(1)} percent of starting capital allocated at purchase cost`}><span style={{width:`${Math.min(100,Math.max(0,allocated))}%`}}/></div><div className="ip-portfolio-grid"><Metric label="Cash" value={`${cash(p?.cash)} ${currency}`}/><Metric label="Open position" value={`${paperAmount(p?.position??'0',market.decimals)} ${market.symbol}`}/><Metric label="Allocated purchase cost" value={`${cash(p?.cost)} ${currency}`} hint={`${allocated.toFixed(1)}% of starting capital`}/><Metric label="Realized P&L" value={`${signed(run.session.metrics.realized)} ${currency}`}/><Metric label="Unrealized P&L" value={`${signed(valuation?.unrealized)} ${currency}`}/><Metric label="Starting balance" value={`${cash(run.config.initialCash)} ${currency}`}/></div><p className="ip-help">Allocation is purchase cost, not current market exposure. Returns include quoted route economics; network gas and setup costs are excluded.</p></section><section className="nd-card ip-record"><div className="nd-eyebrow">RECORD QUALITY</div><h3>Inspect what supports these results.</h3><ul><li><Check size={15}/><span>Separate strategy version<strong>v{run.version} · {run.label}</strong></span></li><li><ShieldCheck size={15}/><span>Local journal replay<strong>{data ? `${data.sequence} events checked` : busy ? 'Checking…' : 'Unavailable'}</strong></span></li><li><Check size={15}/><span>Signed fill quotes<strong>{data ? `${data.signedFills} of ${data.fills} fills` : '—'}</strong></span></li></ul><p className="ip-help">These checks establish local consistency. They do not independently attest which model ran or guarantee future returns.</p><button className="nd-text-button" type="button" onClick={() => setTab('Model & evidence')}>Inspect model and receipts <ArrowRight size={13}/></button></section></div>
      <div className="ip-section-head"><div><div className="nd-eyebrow">RECENT EXECUTION</div><h3>See how decisions became positions.</h3></div><button className="nd-text-button" onClick={() => setTab('Trades & decisions')}>All trades & decisions <ArrowRight size={13}/></button></div><ActivityTable market={market} data={data} fillsOnly compact loading={busy}/>
      <section className="nd-card ip-versions"><div className="nd-eyebrow">STRATEGY HISTORY</div><h3>A version change never inherits an old return.</h3><div className="nd-table-wrap"><table><thead><tr><th>VERSION</th><th>STARTED</th><th>FILLED ORDERS</th><th>PAPER RETURN</th><th>RECORD</th></tr></thead><tbody>{versions.map(r => <tr key={r.id}><td><strong>v{r.version} · {r.label}</strong></td><td>{shortDate(r.createdAt)}</td><td>{r.activity.fills}</td><td>{r.session.metrics.total == null ? '—' : pct(Number(r.session.metrics.total)*100/Number(r.config.initialCash))}</td><td><button type="button" className="nd-text-button" disabled={r.id === run.id} onClick={() => {onSelectRun(r.id);setTab('Overview');}}>{r.id === run.id ? 'Selected' : 'Inspect version'}</button></td></tr>)}</tbody></table></div></section></>}
      {tab === 'Trades & decisions' && <section className="ip-trades"><div className="ip-section-head"><div><div className="nd-eyebrow">TRADING ACTIVITY</div><h3>Orders, reasoning and quote receipts.</h3><p className="ip-help">A BUY or SELL proposal is not a fill. Only filled orders change the paper portfolio.</p></div><button className="nd-button secondary" disabled={!data || busy} onClick={exportReport}><Download size={14}/>Export investor report</button></div><ActivityTable market={market} key={run.id} data={data} loading={busy}/></section>}
      {tab === 'Strategy & risk' && <div className="ip-lower"><section className="nd-card ip-risk"><div className="nd-eyebrow">PUBLIC MANDATE</div><h3>{run.label}</h3><p>{run.config.strategy}</p><p className="ip-help">Published instructions for this exact saved strategy version. Inspect its commitment, limits and trading record before investing.</p><details><summary>Original registration mandate</summary><p>{agent.manifest.strategy.description}</p></details><dl><Fact label="Selected strategy version" value={`v${run.version} · ${run.label}`}/><Fact label="Market" value={`${market.label} · unleveraged spot`}/><Fact label="Per-order cap" value={`${cash(run.config.tradeCap)} ${currency}`}/><Fact label="Allocated-cost cap" value={`${cash(run.config.exposureCap)} ${currency}`}/><Fact label="UTC gross turnover cap" value={`${cash(run.config.dailyTurnoverCap)} ${currency}`}/><Fact label="Slippage tolerance" value={`${run.config.slippageBps} bps · ${(run.config.slippageBps/100).toFixed(2)}%`}/><Fact label="Minimum decision interval" value={`${run.config.intervalMs/1000} seconds + queue and inference time`}/></dl></section><section className="nd-card ip-risk"><div className="nd-eyebrow">BEFORE ALLOCATING</div><h3>Understand what this record measures.</h3><ul className="ip-risk-list"><li><strong>Paper execution</strong>Live dry-run quotes support assumed fills. The agent is not trading the investor vault’s test USDC on an exchange.</li>{market.candles===null&&<li><strong>Vault return</strong>Paper performance is measured in {currency}. The testnet USDC vault applies that percentage return to its own balance. Exchange-rate changes between {currency} and USDC are outside that return.</li>}<li><strong>Observed risk</strong>Drawdown is measured only when equity is recorded. It is not a continuously monitored loss limit.</li><li><strong>Finite sample</strong>{run.activity.fills} fills and {data?.closed.length ?? 'unavailable'} closed positions are observations, not a skill score or a projected annual yield.</li><li><strong>Testnet settlement</strong>A trusted reporter can apply a bound paper round to this vault. Gains require this agent’s separate surplus; deposits and redemptions close during a round.</li></ul><a className="nd-text-button" href={`#${fundingId}`}>Inspect vault balances and ownership <ArrowRight size={13}/></a></section></div>}
      {tab === 'Model & evidence' && <div className="ip-lower"><section className="nd-card ip-risk"><div className="nd-eyebrow">MODEL IDENTITY</div><h3>A measured local model.</h3><dl><Fact label="Model" value={agent.manifest.model.id}/><Fact label="Weights file" value={agent.manifest.model.filename}/><Fact label="Size / quantization" value={`${(agent.manifest.model.bytes/1e9).toFixed(2)} GB · ${agent.manifest.model.quantization}`}/><Fact label="Runtime" value={`${agent.manifest.inference.runtime} · ${agent.manifest.inference.context.toLocaleString()} context`}/><Fact label="Controller declaration" value={agent.manifest.controller}/><Fact label={agent.manifest.inference.runtime==='clef-mlx'?"Model bundle commitment SHA-256":"Weights SHA-256"} value={agent.manifest.model.sha256}/><Fact label="Hardware attestation" value="Not available · local measurements only"/></dl><Link className="nd-text-button" to={`/agents/${agent.id}`}>Full agent declaration <ArrowUpRight size={13}/></Link></section><section className="nd-card ip-risk"><div className="nd-eyebrow">REPLAY & PROVENANCE</div><h3>Trace the selected record.</h3><dl><Fact label="Strategy commitment" value={run.commitment}/><Fact label="Registration commitment" value={agent.commitment}/><Fact label="Paper session" value={run.sessionId}/><Fact label="Verified journal head" value={data?.head ?? 'No verified events'}/><Fact label="Replay checked" value={current ? stamp(current.checkedAt) : 'Not checked'}/><Fact label="Quote source" value="NEAR Intents 1Click · signed live dry-run responses"/><Fact label="Earlier execution exercises" value="Excluded from this strategy record"/></dl><button type="button" className="nd-button secondary" disabled={!current} onClick={exportReport}><Download size={14}/>Export investor report</button><p className="ip-help">The report includes observations and receipt references. Raw inference prompts, responses and private strategy text are omitted. Hashes are consistency evidence, not independent execution proofs.</p></section></div>}
      <p className="ip-footnote">Strategy performance and testnet vault balances are separate records. Investing does not retroactively earn this paper return. No annualized return or profitability forecast is inferred.</p>
    </>}
  </InvestorProfile>;
}
export function InvestorProfile({name,identity,investment,children}: {name:string;identity:ReactNode;investment:ReactNode;children:ReactNode}) {
  return <section className="ip-profile" aria-label={`${name} investor profile`}>
    {identity}
    <div className="ip-investor-layout">
      <div className="ip-investor-content">{children}</div>
      <aside className="ip-investor-sidebar" aria-label="Agent investment">{investment}</aside>
    </div>
  </section>;
}

const profileTabs = ['Overview', 'Trades & decisions', 'Strategy & risk', 'Model & evidence'] as const;
export type InvestorProfileTab = typeof profileTabs[number];

export function InvestorProfileTabs({selected,onSelect}: {selected:InvestorProfileTab;onSelect:(tab:InvestorProfileTab)=>void}) {
  return <div className="ip-tabs" role="group" aria-label="Agent inspection sections">
    {profileTabs.map(tab => <button key={tab} type="button" aria-pressed={tab===selected} onClick={()=>onSelect(tab)}>{tab}</button>)}
  </div>;
}

export function Metric({label,value,hint}: {label:string;value:string;hint?:string}) { return <div className="ip-metric"><small>{label}</small><strong>{value}</strong>{hint && <span>{hint}</span>}</div>; }
function Fact({label,value}: {label:string;value:string}) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }

type ChartObservation = Pick<EquityObservation, 'at' | 'equity'>;

export function EquityChart({market,observations,initial,gapMs,loading,variant='equity'}: {
  market:Pick<ReturnType<typeof paperMarket>,'quoteDecimals'|'quoteSymbol'>;
  observations:ChartObservation[];
  initial:string|null;
  gapMs?:number;
  loading:boolean;
  variant?:'equity'|'realized';
}) {
  const id=useId().replaceAll(':','');
  const [range,setRange]=useState('All'), [hover,setHover]=useState<number|null>(null);
  const realized=variant==='realized';
  const metric=realized?'realized paper P&L':'equity';
  const filtered=useMemo(()=>{
    if(range==='All')return observations;
    const since=Date.now()-(range==='24h'?86400000:604800000);
    const index=observations.findIndex(point=>Date.parse(point.at)>=since);
    if(index<0)return [];
    const points=observations.slice(index);
    if(realized&&index>0&&Date.parse(points[0].at)>since)
      points.unshift({at:new Date(since).toISOString(),equity:observations[index-1].equity});
    return points;
  },[observations,range,realized]);
  const points=filtered.filter(point=>point.equity!=null);
  const start=points[0]?Date.parse(points[0].at):0, end=points.length?Date.parse(points.at(-1)!.at):start;
  const scale=10**market.quoteDecimals;
  const value=(point:ChartObservation)=>Number(point.equity)/scale;
  const base=initial===null?null:Number(initial)/scale;
  const bounds=points.map(value);
  if(base!==null)bounds.push(base);
  const min=bounds.length?Math.min(...bounds):0, max=bounds.length?Math.max(...bounds):0;
  const span=Math.max(max-min,Math.abs(base??max)*.001,1/scale,min===0 && max===0 ? .02 : .000001);
  const padding=span*.12+(span-(max-min))/2;
  const lower=min-padding, upper=max+padding;
  const x=(point:ChartObservation)=>end===start?344:56+(Date.parse(point.at)-start)/(end-start)*576;
  const y=(amount:number)=>185-(amount-lower)/(upper-lower)*163;
  const tick=new Intl.NumberFormat(undefined,{
    notation:Math.max(Math.abs(min),Math.abs(max))>=10000?'compact':'standard',
    maximumFractionDigits:Math.min(market.quoteDecimals,Math.max(2,Math.ceil(-Math.log10(span))+1)),
  });
  const segments:ChartObservation[][]=[];
  let segment:ChartObservation[]=[];
  for(const point of filtered){
    const previous=segment.at(-1);
    if(point.equity==null||previous&&gapMs!==undefined&&Date.parse(point.at)-Date.parse(previous.at)>gapMs){
      if(segment.length)segments.push(segment);
      segment=[];
    }
    if(point.equity!=null)segment.push(point);
  }
  if(segment.length)segments.push(segment);
  const selectedIndex=Math.min(hover??points.length-1,points.length-1);
  const selected=points[selectedIndex];
  const ratio=selected&&base?(value(selected)-base)*100/base:null;
  const sameDay=new Date(start).toDateString()===new Date(end).toDateString();
  const timeLabel=(at:number)=>sameDay?new Date(at).toLocaleTimeString(undefined,{
    hour:'numeric',minute:'2-digit',...(end-start<60000?{second:'2-digit'}:{}),
  }):shortDate(new Date(at).toISOString());

  return <div className="ip-chart">
    <div className="ip-chart-tools">
      <div>{selected?<><strong>{paperAmount(selected.equity,market.quoteDecimals)} {market.quoteSymbol} {ratio!==null&&<span>{pct(ratio)}</span>}</strong><small>{stamp(selected.at)}</small></>:<small>{loading?'Loading published events…':`No recorded ${metric} in this period.`}</small>}</div>
      <div className="ip-range" role="group" aria-label={`${metric} chart period`}>
        {['24h','7d','All'].map(option=><button type="button" key={option} aria-pressed={option===range} onClick={()=>{setRange(option);setHover(null);}}>{option}</button>)}
      </div>
    </div>
    {points.length?<><svg viewBox="0 0 648 220" role="img" aria-label={`${metric} chart for ${range} · ${points.length} observations`}
      onPointerLeave={()=>setHover(null)} onPointerMove={event=>{
        const rect=event.currentTarget.getBoundingClientRect();
        const cursor=(event.clientX-rect.left)*648/rect.width;
        let nearest=0;
        for(let index=1;index<points.length;index++){
          if(Math.abs(x(points[index])-cursor)<Math.abs(x(points[nearest])-cursor))nearest=index;
        }
        setHover(nearest);
      }}>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#b3ef81" stopOpacity=".15"/><stop offset="100%" stopColor="#b3ef81" stopOpacity="0"/></linearGradient></defs>
      {[lower,(lower+upper)/2,upper].map(amount=><g key={amount}>
        <line x1="56" x2="632" y1={y(amount)} y2={y(amount)} stroke="#ffffff15"/>
        <text x="49" y={y(amount)+4} textAnchor="end">{tick.format(Math.abs(amount)<span/100?0:amount)}</text>
      </g>)}
      {base!==null&&<line x1="56" x2="632" y1={y(base)} y2={y(base)} stroke="#a9b99b" strokeOpacity=".5" strokeDasharray="4 5"/>}
      {segments.map((group,index)=>{
        const first=group[0], last=group.at(-1)!;
        if(group.length===1)return <circle key={index} cx={x(first)} cy={y(value(first))} r="3" fill="#b3ef81"/>;
        const line=group.flatMap((point,i)=>realized&&i>0?[
          `${x(point)},${y(value(group[i-1]))}`,`${x(point)},${y(value(point))}`,
        ]:[`${x(point)},${y(value(point))}`]).join(' ');
        return <g key={index}>
          {!realized&&<polygon fill={`url(#${id})`} points={`${x(first)},185 ${line} ${x(last)},185`}/>}
          <polyline fill="none" stroke="#b3ef81" strokeWidth="2" points={line}/>
        </g>;
      })}
      {selected&&<g><line x1={x(selected)} x2={x(selected)} y1="22" y2="185" stroke="#ffffff35" strokeDasharray="3 4"/>
        <circle cx={x(selected)} cy={y(value(selected))} r="4" fill="#b3ef81" stroke="#151c15" strokeWidth="2"/></g>}
      {start===end?<text x="344" y="207" textAnchor="middle">{timeLabel(start)}</text>:<>
        <text x="56" y="207">{timeLabel(start)}</text><text x="632" y="207" textAnchor="end">{timeLabel(end)}</text>
      </>}
    </svg>{points.length>1&&<input className="ip-chart-slider" type="range" aria-label={`Inspect ${metric} observation`}
      aria-valuetext={`${paperAmount(selected?.equity,market.quoteDecimals)} ${market.quoteSymbol} · ${selected?stamp(selected.at):''}`}
      min="0" max={points.length-1} value={selectedIndex} onChange={event=>setHover(Number(event.target.value))}/>}</>:<div className="ip-chart-empty">{loading?'Loading chart…':'No observations for this period.'}</div>}
    <p className="ip-help">{realized?'The line moves when paper gains or losses are realized. Deposits, withdrawals and open positions are excluded.':`Recorded valuations only. Gaps over ${(gapMs??0)/60000} minutes are disconnected.`}</p>
  </div>;
}
function ActivityTable({market,data,fillsOnly=false,compact=false,loading}: {market:ReturnType<typeof paperMarket>;data?:AgentPerformance;fillsOnly?:boolean;compact?:boolean;loading:boolean}) {
  const cash=(value:string|null|undefined)=>paperAmount(value,market.quoteDecimals);
  const signed=(value:string|null|undefined)=>value!=null&&BigInt(value)>0n?'+'+cash(value):cash(value);
  const [filter,setFilter] = useState(fillsOnly?'fills':'all'), [page,setPage] = useState(0);
  const events = (data?.activity ?? []).filter(e=>filter==='all'||filter==='fills'&&e.kind==='fill'||filter==='decisions'&&e.kind==='model'||filter==='blocked'&&e.kind==='blocked');
  const size=compact?5:15, pages=Math.max(1,Math.ceil(events.length/size)), current=Math.min(page,pages-1), shown=events.slice(current*size,current*size+size);
  return <div className="nd-card ip-activity">{!compact&&<div className="ip-filters" role="group" aria-label="Filter trading activity">{[['all','All activity'],['fills','Filled orders'],['decisions','Model decisions'],['blocked','Blocked attempts']].map(([value,label])=><button type="button" key={value} aria-pressed={filter===value} onClick={()=>{setFilter(value);setPage(0);}}>{label}</button>)}</div>}
    {!shown.length?<div className="ip-empty"><h3>{loading?'Reading the verified journal…':filter==='fills'?'No filled orders in this strategy.':'No activity in this view.'}</h3><p>{filter==='fills'?'A recorded model decision can be HOLD or blocked; neither is counted as a filled order.':'Recorded decisions and rejected attempts will appear here.'}</p></div>:<div className="nd-table-wrap"><table><thead><tr><th>TIME / EVENT</th><th>ACTION</th><th>NOTIONAL · {market.quoteSymbol}</th><th>REALIZED P&L</th><th>REASON & RECEIPT</th></tr></thead><tbody>{shown.map(e=><tr key={e.hash}><td><strong>{new Date(e.at).toLocaleTimeString()}</strong><small>{shortDate(e.at)} · #{e.sequence}</small><small>{e.operatorDirected?'Owner-requested paper exit':e.kind==='fill'?'Simulated fill':e.kind==='model'?'Model proposal':e.kind==='dust'?'Paper dust adjustment':'Blocked attempt'}</small></td><td><span className={`ip-action ${e.action==='BUY'?'buy':e.action==='SELL'?'sell':''}`}>{e.action??(e.kind==='dust'?'ADJUSTMENT':'BLOCKED')}</span></td><td>{cash(e.notional)}{e.near&&<small>{paperAmount(e.near,market.decimals)} {market.symbol}</small>}</td><td className={e.realized!=null&&BigInt(e.realized)<0n?'negative':''}>{signed(e.realized)}{e.kind==='fill'&&e.action==='SELL'&&<small>This exit leg only</small>}</td><td><p>{e.reason}</p><details><summary>Inspect receipt</summary><dl><Fact label="Event SHA-256" value={e.hash}/>{e.quote&&<><Fact label="Quote ID" value={e.quote.id}/><Fact label="Quote signature" value={e.quote.signed?'Verified by local service':'Not verified'}/><Fact label="Quote observed" value={stamp(e.quote.observedAt)}/><Fact label="Quote received" value={stamp(e.quote.receivedAt)}/><Fact label="Quote source" value={e.quote.source}/></>}</dl></details></td></tr>)}</tbody></table></div>}
    {!compact&&<div className="ip-pagination"><span>{events.length} events · Page {current+1} of {pages}</span><div><button type="button" className="nd-text-button" disabled={current===0} onClick={()=>setPage(current-1)}>Previous</button><button type="button" className="nd-text-button" disabled={current+1>=pages} onClick={()=>setPage(current+1)}>Next</button></div></div>}
  </div>;
}
