import {DirectoryConnection} from './DirectoryConnection';
import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Bot, Check, Cpu, Download, Fingerprint, RefreshCw, Search, ShieldCheck, Menu, X } from 'lucide-react';
import type { InstalledModel, AgentManifest, BenchmarkRun } from '../../../near-demo/public-types';
import type { Session, Proposal, Event } from '../../../near-demo/types';
import { AgentConsole, type ConsoleRun } from './AgentConsole';
import { NearWalletButton, useNearWallet } from './NearWalletProvider';
import { NearLanding } from './NearLanding';
import { AgentVaults,type VaultRow } from './AgentVaults';
import './NearDemo.css';
import './NearAgents.css';
import './AgentVisibility.css';
import { AgentLeaderboard } from './AgentLeaderboard';
import { hostedApp } from '../lib/hosting';
import { lastModelDirectory, pickModelDirectory, rememberModelDirectory, scanModelDirectory, scanSelectedModelFiles, type BrowserModel } from '../lib/browser-models';
import { browserWorkspace, browserWorkspaceAction, createBrowserAgent, publishBrowserAgent } from '../lib/browser-workspace';
import { PublicDecisionJournal, PublicJournalCatalog } from './PublicDecisionJournal';
import { authorizeWithOwnerWallet } from '../lib/public-journal-wallet';
import { BrowserWorkspaceTransfer } from './BrowserWorkspaceTransfer';
const PumpDocs = lazy(() => import('./PumpDocs'));
type Agent={visibility?:'private'|'public';id:string;createdAt:string;manifest:AgentManifest;commitment:string;sessionId:string;session:Session&{valuationStale:boolean;error?:string|null;metrics:{total:string|null;realized:string;unrealized:string|null;returnBps:number|null}};exercise?:{phase:string;disclosure:string;startedAt:string};activity:{buys:number;sells:number;directed:boolean;directedFills:number;decisions:number;holds:number;fills:number;blocked:number;latest:{at:string;proposal?:Proposal}|null;manual:boolean;firstAt:string|null;lastAt:string|null}};
type Registry={directory?:{mode:string;url:string;enabledOwners:string[];error:string};directoryError?:string;vaultFactoryReady?:boolean;pendingStrategyAgents?:string[];vaults:VaultRow[];strategyRuns:ConsoleRun[];continuous:{enabled:boolean;targetPerAgent:number;activeAgentId:string|null;phase:string;error:string|null}|null;agents:Agent[];execution:{activeId:string|null;queued:string[]};models:InstalledModel[];measurement:{modelId:string;completedBytes:number;totalBytes:number}|null;runtime:{modelId:string|null;phase:string};comparisons:BenchmarkRun[];market:{id:string;source:string;symbol:string;count:number;from:number;through:number;capturedAt:string;stale:boolean}|null;policy:{startingCash:string;decisions:number;feeBps:number;slippageBps:number;fill:string}};
const dollars=(s:string|null|undefined)=>s==null?'—':(Number(s)/1e6).toLocaleString(undefined,{maximumFractionDigits:2});
const percent=(n:number|undefined|null)=>n==null?'—':`${n>=0?'+':''}${(n/100).toFixed(2)}%`;
const date=(s:string|number)=>new Date(s).toLocaleString();
function liveReturn(a:Agent){const equity=a.session.portfolio.equity;if(equity===null)return '—';const n=Number(BigInt(equity)-BigInt(a.session.config.initialCash))*100/Number(a.session.config.initialCash);if(n===0)return '0.00%';return `${n>0?'+':'−'}${Math.abs(n)<0.0001?'<0.0001':Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4})}%`;}
function amount(s:string){if(!/^\d+(?:\.\d{1,6})?$/.test(s))throw new Error('Enter an amount with at most six decimal places.');const [a,b='']=s.split('.');return String(BigInt(a)*1000000n+BigInt(b.padEnd(6,'0')));}
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function Header(){const [open,setOpen]=useState(false);return <><header className="nd-header"><Link className="nd-brand" to="/" onClick={()=>setOpen(false)}><span className="nd-logo">p.</span>pump</Link><button type="button" className="na-menu-toggle" aria-expanded={open} aria-controls="platform-navigation" onClick={()=>setOpen(!open)}>{open?<X size={14}/>:<Menu size={14}/>}Menu</button><nav id="platform-navigation" className={open?'na-nav-open':''}><NavLink to="/vaults" onClick={()=>setOpen(false)}>Explore agents</NavLink><NavLink to="/evidence" onClick={()=>setOpen(false)}>Leaderboard</NavLink><NavLink to="/console" onClick={()=>setOpen(false)}>My agents</NavLink><NavLink to="/register" onClick={()=>setOpen(false)}>Create an agent</NavLink><NavLink to="/docs" onClick={()=>setOpen(false)}>Docs</NavLink></nav><div className="nd-header-right"><span className="nd-network"><i/>NEAR testnet</span><NearWalletButton/></div></header><div className="nd-banner"><ShieldCheck size={14}/><strong>Paper trading</strong><span>Local models · Inspectable decisions · Simulated fills</span><span>Mainnet trading disabled</span></div></>;}
function Title({eyebrow,title,body,children}:{eyebrow:string;title:string;body:string;children?:ReactNode}){return <div className="nd-title na-title"><div><div className="nd-eyebrow">{eyebrow}</div><h1>{title}</h1><p>{body}</p></div>{children}</div>;}
export function NearAgentsApp(){return <BrowserRouter><RegistryApp/></BrowserRouter>;}
function RegistryApp(){
  const {pathname,search}=useLocation();
  const docsMode=pathname==='/docs'||pathname.startsWith('/docs/');
  useEffect(()=>{if(docsMode)return;window.scrollTo(0,0);document.title=pathname==='/'?'pump · Privacy-first trading models.':pathname==='/vaults'?'Explore agents · pump':pathname==='/evidence'?'Leaderboard · pump':pathname==='/console'?'My agents · pump':pathname==='/register'?'Register an agent · pump NEAR':'pump · Accountable intelligence on NEAR';},[pathname,docsMode]);
  const ownerMode=pathname==='/console'||pathname==='/register'||pathname==='/evidence/archive';
  const needsRegistry=!docsMode&&!(hostedApp&&pathname==='/register');
  const [loaded,setLoaded]=useState<{owner:boolean;registry:Registry}>(),[error,setError]=useState('');const token=useRef(''),request=useRef(0);
  const data=loaded?.owner===ownerMode?loaded.registry:undefined;
  async function load(){
    const id=++request.current,owner=ownerMode;
    let registry:Registry;
    if(hostedApp&&owner){
      registry=await browserWorkspace();
    }else{
      const response=await fetch(owner?'/api/near-demo/status':'/api/near-demo/public-status');
      if(!response.ok)throw new Error(owner?'Could not load agent workspace.':'The public directory is temporarily unavailable. Please try again.');
      const result=await response.json();
      if(owner)token.current=result.token;
      registry=result.registry;
    }
    if(id===request.current){setLoaded({owner,registry});setError('');}
  }
  async function api(path:string,body:unknown={}){
    if(hostedApp&&ownerMode)return browserWorkspaceAction(path,body);
    const publicPaths=['/nav-evidence','/strategy-report','/strategy-history','/history','/vault-state','/vault-plan','/vault-receipt'];
    if(!ownerMode&&!publicPaths.includes(path))throw new Error('This action requires owner access.');
    if(ownerMode&&!token.current)await load();
    const init={method:'POST',headers:{'Content-Type':'application/json',...(ownerMode?{'X-Pumpcoin-Demo-Token':token.current}:{})},body:JSON.stringify(body)};const r=ownerMode?await fetch('/api/near-demo'+path,init):await fetch('/api/near-demo/public-'+path.slice(1),init);const d=await r.json();if(!r.ok)throw new Error(d.error||'Local operation failed.');return d;
  }
  useEffect(()=>{if(!needsRegistry)return;let active=true;const update=()=>{void load().catch(e=>{if(active)setError(e.message);});};update();const t=setInterval(update,5000);return()=>{active=false;clearInterval(t);++request.current;};},[ownerMode,needsRegistry]);
  const refresh=async()=>{await load();};
  return <div className="near-demo na-shell"><Header/><main className="nd-main na-main">{needsRegistry&&error&&<p role="alert" className="nd-alert">{error}<button className="nd-text-button" onClick={()=>void refresh().catch(e=>setError(e.message))}>Retry</button></p>}{needsRegistry&&data?.directoryError&&<p role="alert" className="nd-alert">{data.directoryError}</p>}<Routes><Route path="/docs/:slug?" element={<Suspense fallback={<p role="status">Loading documentation…</p>}><PumpDocs/></Suspense>}/><Route path="/" element={<NearLanding data={data}/>}/><Route path="/console" element={<ConsolePage data={data} api={api} refresh={refresh} loadFailed={!!error}/>}/><Route path="/public-journal/:agentId" element={<PublicDecisionJournal/>}/><Route path="/vaults" element={<><AgentVaults loading={!data} agents={data?.agents??[]} vaults={data?.vaults??[]} runs={data?.strategyRuns??[]} api={api} refresh={refresh}/>{hostedApp&&!search&&<PublicJournalCatalog/>}</>}/><Route path="/register" element={<Register data={data} api={api} refresh={refresh}/>}/><Route path="/agents/:agentId" element={<Profile data={data} api={api}/>}/><Route path="/evidence" element={data?<AgentLeaderboard api={api} agents={data.agents} runs={data.strategyRuns??[]} vaults={data.vaults??[]}/>:<p role="status">Loading leaderboard…</p>}/><Route path="/evidence/archive" element={<Evidence data={data} api={api}/>}/><Route path="*" element={<Navigate to="/vaults" replace/>}/></Routes><footer className="nd-footer"><span>pump · Evidence before capital.</span><span>Local declarations · Hypothetical returns · NEAR testnet</span></footer></main></div>;
}
type Props={data?:Registry;api:(path:string,body?:unknown)=>Promise<any>;refresh:()=>Promise<void>};
function ConsolePanel({data,api,refresh}:Props){return data?<AgentConsole vaultFactoryReady={data.vaultFactoryReady} pendingStrategyAgents={data.pendingStrategyAgents} agents={data.agents} runs={data.strategyRuns??[]} execution={data.execution} runtime={data.runtime} vaults={data.vaults} unavailable={!!data.continuous?.enabled||data.comparisons.some(r=>r.state==='running')} api={api} refresh={refresh}/>:<p role="status">Loading agent console…</p>;}
function ConsolePage(props:Props&{loadFailed?:boolean}){const location=useLocation(),q=new URLSearchParams(location.search),id=q.get('agent');if(!props.data&&props.loadFailed)return <Title eyebrow="CREATOR WORKSPACE" title="My agents" body="Configure strategies and follow your agents’ decisions."><Link className="nd-button" to="/register">Create an agent</Link></Title>;if(q.get('panel')==='identity'&&id)return <Profile data={props.data} api={props.api} agentIdOverride={id} privateView/>;if(q.get('panel')==='vault'&&id)return <AgentVaults loading={!props.data} agents={props.data?.agents??[]} runs={props.data?.strategyRuns??[]} vaults={props.data?.vaults??[]} api={props.api} refresh={props.refresh} ownerView/>;return <><DirectoryConnection status={props.data?.directory} api={props.api} refresh={props.refresh}/><ConsolePanel {...props}/>{hostedApp&&!id&&<BrowserWorkspaceTransfer refresh={props.refresh}/>}</>;}
function HistoricalCurve({steps}:{steps:BenchmarkRun['results'][number]['steps']}){
 if(!steps.length)return null;
 const values=steps.map(s=>Number(s.equity)/1e6),low=Math.min(...values),high=Math.max(...values),range=Math.max(.01,high-low);
 return <div className="nd-card na-detail"><h3>Recorded historical equity · virtual USDT</h3><svg viewBox="0 0 700 170" role="img" aria-label={`${steps.length} historical equity observations`} style={{width:'100%',marginTop:20}}><text x="8" y="18" fill="#a8ba9a" fontSize="11">{high.toFixed(2)}</text><text x="8" y="140" fill="#a8ba9a" fontSize="11">{low.toFixed(2)}</text><polyline fill="none" stroke="#b3ef81" strokeWidth="2" points={values.map((v,i)=>`${65+i*620/Math.max(1,values.length-1)},${140-(v-low)*120/range}`).join(' ')}/><text x="65" y="165" fill="#a8ba9a" fontSize="10">{new Date(steps[0].at).toLocaleDateString()}</text><text x="685" y="165" fill="#a8ba9a" fontSize="10" textAnchor="end">{new Date(steps.at(-1)!.at).toLocaleDateString()}</text></svg></div>;
}
function LiveJournal({sessionId,sequence,api}:{sessionId:string;sequence:number;api:Props['api']}){
 const [events,setEvents]=useState<Event[]>([]),[error,setError]=useState(''),apiRef=useRef(api);apiRef.current=api;
 useEffect(()=>{let disposed=false,retry:ReturnType<typeof setTimeout>|undefined;const read=async()=>{try{const d=await apiRef.current('/history',{id:sessionId});if(!disposed){setEvents(d.events);setError('');}}catch(e){if(!disposed){setError((e as Error).message);retry=setTimeout(()=>void read(),5000);}}};void read();return()=>{disposed=true;clearTimeout(retry);};},[sessionId,sequence]);
 return <section className="nd-card na-detail"><h2>Earlier session record</h2><p className="na-note">Preserved registration-session activity. Strategy-version performance is available in this agent’s investor profile.</p>{error&&<p role="alert" className="nd-alert">{error}</p>}<details className="na-decision-log"><summary>Inspect earlier decisions and fills</summary>{events.filter(e=>['model','fill','blocked'].includes(e.kind)).slice(-40).reverse().map(e=><div key={e.hash}><strong>{date(e.at)} · {e.kind==='fill'?`Simulated ${e.action} fill`:e.kind==='model'?(e.model?`Model ${e.model.proposal.action}`:'Scenario request'):'Blocked attempt'}</strong><p>{e.reason}</p><small>SHA-256 {e.hash}</small></div>)}</details></section>;
}
function Comparison({data,agentId}:{data?:Registry;agentId?:string}){
  const [selected,setSelected]=useState('');const runs=(data?.comparisons??[]).filter(r=>!agentId||r.results.some(x=>x.agentId===agentId)),run=runs.find(r=>r.id===selected)??runs[0];
  if(!run)return <div className="na-note">No comparison recorded yet. A shared run gives every agent the same data and accounting assumptions. Live quote sessions remain separate.</div>;
  const complete=run.results.length>=2&&run.state==='complete'&&run.results.every(r=>r.state==='complete'&&r.steps.length===24&&!r.steps.some(s=>s.status==='error'));
  const eligible=complete&&run.results.every(r=>r.steps.filter(s=>s.status==='fill'&&s.proposal?.action==='SELL'&&s.wallet.position==='0').length>=2);
  const rows=[...run.results].sort((a,b)=>eligible?b.returnBps-a.returnBps:0).filter(r=>!agentId||r.agentId===agentId);
  return <><div className="na-run-meta"><span className={`nd-pill ${complete?'':'warning'}`}>{complete?'Completed historical comparison':run.state==='running'?'Running · results provisional':run.state}</span><span>{date(run.createdAt)} · Dataset {run.datasetId.slice(0,12)||'loading…'}</span>{runs.length>1&&<select aria-label="Comparison run" value={run.id} onChange={e=>setSelected(e.target.value)}>{runs.map(r=><option value={r.id} key={r.id}>{date(r.createdAt)} · {r.state}</option>)}</select>}</div>{run.error&&<p className="nd-inline-error">{run.error}</p>}<div className="nd-table-wrap na-rankings"><table><thead><tr><th>RETURN RANK</th><th>AGENT / MODEL</th><th>PAPER RETURN</th><th>OBSERVED DRAWDOWN</th><th>DECISIONS / FILLS</th><th>STATE</th></tr></thead><tbody>{rows.map(r=><tr key={r.agentId}><td>{eligible?1+run.results.filter(x=>x.returnBps>r.returnBps).length:'—'}</td><td><Link to={`/agents/${r.agentId}`}><strong>{data?.agents.find(a=>a.id===r.agentId)?.manifest.name??r.modelId}</strong><small>{r.modelId}</small></Link></td><td className={r.returnBps>=0?'positive':'negative'}>{percent(r.returnBps)}<small>{dollars(r.equity)} USDT · modeled liquidation</small></td><td>{(r.maxDrawdownBps/100).toFixed(2)}%</td><td>{r.steps.length} / {r.steps.filter(s=>s.status==='fill').length}<small>{r.steps.filter(s=>s.status==='hold').length} holds · {r.steps.filter(s=>s.status==='error'||s.status==='blocked').length} failed / blocked</small></td><td>{r.state}</td></tr>)}</tbody></table></div><p className="na-note">{!eligible&&'Return ranking is withheld until every participant completes the shared run and records at least two closed positions. '}Holding cash returns 0% before inflation; no trades alone do not demonstrate trading skill. Exploratory historical replay. Next-bar fills; 0.10% fee plus 0.10% adverse slippage per side. Exit costs included in daily valuation. Gas and market impact excluded. NEAR/USDT exchange history is research data, distinct from USDC Intents quotes. Twenty-four decisions are a small sample, not evidence of future returns.</p>{agentId&&rows.map(r=><HistoricalCurve key={r.agentId+'-curve'} steps={r.steps}/>)}{agentId&&rows.map(r=>r.runtime&&<details className="na-decision-log" key={r.agentId+'-runtime'}><summary>Inspect inference configuration</summary><Facts rows={Object.entries(r.runtime).map(([key,value])=>[key,String(value)] as [string,ReactNode])}/></details>)}{agentId&&rows.flatMap(r=>r.steps).length>0&&<details className="na-decision-log"><summary>Inspect every historical decision</summary>{rows.flatMap(r=>r.steps).map((s,i)=><div key={s.hash}><strong>{i+1}. {date(s.at)} · {s.proposal?.action??'Error'} · {s.status}</strong><p>{s.reason}</p><small>Equity {dollars(s.equity)} USDT · SHA-256 {s.hash}</small></div>)}</details>}</>;
}
const STRATEGY='Use the supplied closed NEAR candles to assess momentum, volatility and volume. Build an unleveraged spot position when the recent trend and volume support it; reduce exposure when the trend weakens. Explain the signal. Protect capital and HOLD when the evidence does not support a trade.';
function Register({data,api,refresh}:Props){
  const wallet=useNearWallet();
  const navigate=useNavigate(),[step,setStep]=useState(1),[name,setName]=useState(''),[owner,setOwner]=useState<string|null>(null),[modelId,setModelId]=useState(''),[strategy,setStrategy]=useState(STRATEGY),[capital,setCapital]=useState('100'),[trade,setTrade]=useState('20'),[exposure,setExposure]=useState('80'),[daily,setDaily]=useState('100'),[slippage,setSlippage]=useState('50'),[interval,setIntervalValue]=useState('60'),[visibility,setVisibility]=useState<'private'|'public'>('private'),[selfHosted,setSelfHosted]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const [browserModels,setBrowserModels]=useState<BrowserModel[]>([]);
  const [scanned,setScanned]=useState(false);
  const [measurementPercent,setMeasurementPercent]=useState(0);
  const folderInput=useRef<HTMLInputElement>(null);
  const detectionInProgress=useRef(false);
  const models=hostedApp?browserModels:data?.models??[];
  const model=models.find(m=>m.id===modelId),effectiveOwner=owner??wallet.account;

  function applyBrowserScan(found:BrowserModel[]){
    setBrowserModels(found);
    setModelId(current=>found.some(model=>model.id===current)?current:'');
    setScanned(true);
  }

  async function detect(files?:FileList){
    if(detectionInProgress.current)return;
    if(hostedApp&&!pickModelDirectory&&!files){folderInput.current?.click();return;}
    detectionInProgress.current=true;
    setBusy('detect');setError('');
    try{
      if(!hostedApp){await api('/models');await refresh();return;}
      if(files){applyBrowserScan(await scanSelectedModelFiles(files));return;}
      const directory=await pickModelDirectory!({id:'pump-models',mode:'read'});
      applyBrowserScan(await scanModelDirectory(directory));
      void rememberModelDirectory(directory).catch(()=>{});
    }catch(cause){
      if(cause instanceof DOMException&&cause.name==='AbortError')return;
      setError(cause instanceof DOMException?'Could not read that folder. Click Detect again to choose a model folder and allow access.':(cause as Error).message);
    }finally{detectionInProgress.current=false;setBusy('');}
  }

  useEffect(()=>{
    if(!hostedApp){void Promise.resolve().then(()=>detect());return;}
    if(!pickModelDirectory)return;
    let active=true;
    setBusy('detect');
    async function rescan(){
      try{
        const directory=await lastModelDirectory();
        if(!active||!directory||await directory.queryPermission({mode:'read'})!=='granted')return;
        const found=await scanModelDirectory(directory);
        if(active)applyBrowserScan(found);
      }catch{/* Detect again can reopen the folder picker if access has expired. */}
      finally{if(active)setBusy('');}
    }
    void rescan();
    return()=>{active=false;};
    // Inventory discovery runs once when this registration page mounts.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  function choose(id:string){setModelId(id);}
  function registration(){if(!model)throw new Error('Select one of the detected installed models.');if(!name.trim())throw new Error('Enter an agent name.');if(!selfHosted)throw new Error('Confirm self-hosted inference.');if(!/^(?:[a-f0-9]{64}|[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet)$/.test(effectiveOwner))throw new Error('Enter a public NEAR testnet account.');if(strategy.trim().length<20)throw new Error('Describe the strategy and conditions for holding.');const tradeCap=amount(trade),exposureCap=amount(exposure),dailyTurnoverCap=amount(daily),initialCash=amount(capital);if([tradeCap,exposureCap,dailyTurnoverCap,initialCash].some(n=>BigInt(n)<=0n||BigInt(n)>1000000000000n))throw new Error('Use positive limits up to one million quote units.');if(BigInt(tradeCap)>BigInt(exposureCap)||BigInt(tradeCap)>BigInt(dailyTurnoverCap))throw new Error('Per-trade cap must fit within the exposure and turnover limits.');if(!Number.isInteger(+slippage)||+slippage<0||+slippage>1000)throw new Error('Slippage must be 0–1,000 basis points.');if(!Number.isInteger(+interval)||+interval<15||+interval>3600)throw new Error('Decision interval must be 15–3,600 seconds.');return {visibility,name,controller:effectiveOwner,modelId,strategy,tradeCap,exposureCap,dailyTurnoverCap,slippageBps:+slippage,initialCash,intervalMs:+interval*1000};}
  async function register(){
    setBusy('register');setError('');setMeasurementPercent(0);
    try{
      const input=registration();
      let agentId:string;
      if(hostedApp){
        const selected=browserModels.find(candidate=>candidate.id===input.modelId);
        if(!selected)throw new Error('Select one of the detected installed models.');
        if(input.visibility==='public')await authorizeWithOwnerWallet(input.controller,wallet.account);
        agentId=(await createBrowserAgent(input,selected,bytes=>setMeasurementPercent(Math.floor(bytes/selected.bytes*100)))).id;
        if(input.visibility==='public'){
          try{await publishBrowserAgent(agentId);}
          catch{navigate(`/console?agent=${agentId}&scope=local&publication=pending`);return;}
          navigate(`/public-journal/${agentId}`);return;
        }
      }else{
        const result=await api('/register-agent',{registration:input});
        agentId=result.agent.id;
        await refresh();
      }
      navigate(visibility==='private'?`/console?agent=${agentId}&scope=local&panel=identity`:`/agents/${agentId}`);
      window.scrollTo(0,0);
    }catch(e){setError((e as Error).message);}finally{setBusy('');}
  }
  function next(){try{registration();setError('');setStep(step+1);window.scrollTo(0,0);}catch(e){setError((e as Error).message);}}
  const input=(label:string,value:string,set:(s:string)=>void,hint?:string)=><label>{label}<input required value={value} onChange={e=>set(e.target.value)}/>{hint&&<small>{hint}</small>}</label>;
  return <><div className="nd-title na-title"><h1>Create your trading agent.</h1></div>
    <div className="na-registration">
      <aside><ol className="na-wizard">{['Identity & inference','Strategy & mandate','Review & export'].map((title,i)=>
        <li key={title} className={step===i+1?'current':step>i+1?'complete':''}>
          <span>{step>i+1?<Check size={15}/>:String(i+1).padStart(2,'0')}</span><div><strong>{title}</strong></div>
        </li>)}</ol></aside>
      <form className="nd-card na-form" onSubmit={e=>{e.preventDefault();if(busy)return;if(step<3)next();else void register();}}>
        <h2>{step===1?'Identity & local inference':step===2?'A strategy with limits.':'Review your declaration.'}</h2>
        {step===1&&<>
          <fieldset className="na-visibility">
            <legend>Agent visibility</legend>
            <label><input type="radio" name="visibility" value="private" checked={visibility==='private'} onChange={()=>setVisibility('private')}/>
              <span><strong>Private</strong><small>Visible only in My agents. Investors cannot deposit.</small></span>
            </label>
            <label><input type="radio" name="visibility" value="public" checked={visibility==='public'} onChange={()=>setVisibility('public')}/>
              <span><strong>Public</strong><small>{hostedApp?'Publishes the agent identity and future paper decisions. Strategy instructions stay local.':'Permanently shares your agent, strategy and trading record. Enables investor deposits.'}</small></span>
            </label>
          </fieldset>
          <div className="nw-registration"><strong>NEAR wallet</strong><NearWalletButton/></div>
          <div className="na-fields">
            {input('Agent name',name,setName)}
            <div>
              {input('Controller account',effectiveOwner,setOwner,'Public NEAR testnet account')}
              {owner!==null&&wallet.account&&<button type="button" className="nd-text-button" onClick={()=>setOwner(null)}>Use connected account</button>}
            </div>
          </div>
          <section className="na-model-detector">
            <div className="nd-card-top">
              <div className="na-detector-heading"><Cpu size={25}/><h3>Your local models</h3></div>
              {models.length>0&&<span className="nd-pill">{models.length} locally detected</span>}
            </div>
            {hostedApp&&<div>
              <p>Click <strong>Detect again</strong>, select your model folder, and allow read access.</p>
              <p><strong>Ollama on Mac</strong> uses <code>~/.ollama/models</code> by default. Press <kbd>⌘⇧G</kbd> in the picker to paste the path.</p>
              <p><strong>Other downloads</strong> can stay where they are or be moved to a folder you know. For llama.cpp, check <code>~/.local/share/llama.cpp</code>.</p>
            </div>}
            <label>Choose an installed local model
              <select aria-label="Choose an installed local model" value={modelId} onChange={e=>choose(e.target.value)}>
                <option value="">Select downloaded weights</option>
                {models.map(m=><option key={m.id} value={m.id}>{m.name} · {(m.bytes/1e9).toFixed(2)} GB</option>)}
              </select>
            </label>
            {model&&<details>
                <summary>{hostedApp?'Inspect detected model':'Inspect locally measured artifacts'}</summary>
                <p>{model.filename} · {model.quantization}</p>
                <p>{model.runtime==='clef-mlx'?'MLX bundle':'GGUF weights'} detected {date(model.detectedAt)}.</p>
                {hostedApp?<p>Detected on this device. Weight checksums have not been verified.</p>:<>
                  <p>{model.runtime==='clef-mlx'?'All weights, decision head, tokenizer and loader are verified; the bundle commitment identifies the full artifact set.':'SHA-256 is measured from the selected file during registration.'}</p>
                  <p>{model.copies>1?`${model.copies} filesystem entries share this underlying file.`:'One detected filesystem entry.'} Model weights are read in place.</p>
                  <p>Runtime: {model.runtime??'llama.cpp'} · loopback only · no hardware attestation.</p>
                </>}
            </details>}
            {busy==='detect'&&<p role="status">Looking for local models…</p>}
            {busy!=='detect'&&!models.length&&(scanned||!hostedApp&&!error)&&
              <p role="status">No supported models found{hostedApp?' in that folder':''}.</p>}
            <button type="button" className="nd-button secondary" disabled={!!busy} onClick={()=>void detect()}><RefreshCw size={14}/>Detect again</button>
            {hostedApp&&!pickModelDirectory&&<input type="file" hidden ref={input=>{
              folderInput.current=input;
              if(input)input.webkitdirectory=true;
            }} onChange={event=>{
              const input=event.currentTarget;
              if(input.files)void detect(input.files);
              input.value='';
            }}/>}
          </section>
          <label className="na-checkbox"><input type="checkbox" checked={selfHosted} onChange={e=>setSelfHosted(e.target.checked)}/><span>I use local model weights with no hosted fallback.</span></label>
        </>}
    {step===2&&<>{model?.runtime==='clef-mlx'&&<p className="nd-notice">Clef chooses BUY, SELL or HOLD. Uncertain signals result in HOLD. Each paper trade is capped at 10 virtual USDC.</p>}<label>{visibility==='private'?'Private strategy description':'Public strategy description'}<textarea rows={5} maxLength={3000} value={strategy} onChange={e=>setStrategy(e.target.value)}/><small>Describe when to buy, sell or hold.</small></label><label>Proposed market<select><option>wNEAR / USDC</option></select></label><div className="na-fields">{input('Virtual starting balance · USDC',capital,setCapital)}{input('Per-trade cap · USDC',trade,setTrade)}{input('Allocated-cost exposure cap · USDC',exposure,setExposure)}{input('Daily gross turnover cap · USDC',daily,setDaily)}{input('Maximum slippage · basis points',slippage,setSlippage,'50 basis points = 0.5%.')}{input('Decision interval · seconds',interval,setIntervalValue)}</div></>}
    {step===3&&<><div className="na-review-name"><span className="nd-avatar large"><Bot size={24}/></span><div><h2>{name}</h2><p>{model?.name} · wNEAR / USDC</p></div><span className="nd-pill warning">Unpublished declaration</span></div><Facts rows={[["Visibility",visibility==='private'?'Private · hidden · no investor deposits':hostedApp?'Public identity and future decision outcomes':'Public · permanent publication · strategy and trading record inspectable'],["Controller",effectiveOwner],["Inference policy","Self-hosted only · no hosted fallback"],["Weights",`${model?.filename} · ${((model?.bytes??0)/1e9).toFixed(2)} GB`],["Runtime",`${model?.runtime??'llama.cpp'} · 4,096 context · sequential loading`],["Virtual starting balance",`${capital} USDC`],["Trade / exposure / daily cap",`${trade} / ${exposure} / ${daily} USDC`],["Maximum slippage",`${slippage} basis points`],["Decision interval",`${interval} seconds`],["Strategy",strategy],["Registration evidence","Locally measured weights · unsigned declaration · no hardware attestation"],["Network & mode","NEAR testnet · paper trading · optional Circle test USDC clearing"]]}/><button type="button" className="nd-button secondary" onClick={()=>download('near-agent-declaration-draft.json',{status:'unregistered draft; weights not yet measured',...registration()})}><Download size={15}/>Export local draft</button><div className="na-note">Registration does not move tokens or grant wallet signing access.</div>{busy==='register'&&<p role="status" className="nd-notice">Measuring downloaded weights… {hostedApp?`${measurementPercent}%`:data?.measurement?`${Math.round(data.measurement.completedBytes/data.measurement.totalBytes*100)}%`:'Starting SHA-256 check'}. The file stays in place.</p>}</>}
    {error&&<p className="nd-alert" role="alert">{error}</p>}<div className="na-wizard-controls"><button type="button" className="nd-text-button" disabled={step===1||!!busy} onClick={()=>{setStep(step-1);setError('');}}>Back</button><span>Step {step} of 3</span><button type="submit" className="nd-button" disabled={!!busy}>{step<3?'Continue':busy==='register'?'Measuring weights…':visibility==='private'?'Create private agent':'Create public agent'}<ArrowRight size={15}/></button></div></form></div></>;
}
function Facts({rows}:{rows:[string,ReactNode][]}){return <dl className="na-facts">{rows.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;}
function Profile({data,api,agentIdOverride,privateView=false}:Pick<Props,'data'|'api'>&{agentIdOverride?:string;privateView?:boolean}){
  const params=useParams(),agentId=agentIdOverride??params.agentId,a=data?.agents.find(a=>a.id===agentId&&(privateView||a.visibility!=='private'));
  if(!data)return <p role="status">Loading agent details…</p>;if(!a)return <div className="nd-empty"><h2>Agent registration not found.</h2><p>This profile belongs to another instance, or registration has not completed.</p><Link to="/vaults">Explore agents</Link></div>;
  const m=a.manifest,practice=data.comparisons.find(r=>r.results.some(x=>x.agentId===a.id))?.results.find(r=>r.agentId===a.id);
  return <><Link className="nd-text-button" to={privateView?'/console':'/vaults'}>← {privateView?'My agents':'All agents'}</Link><Title eyebrow="REGISTERED AGENT · NEAR" title={m.name} body={m.strategy.description}><div className="nd-buttons">{a.visibility==='private'?<Link className="nd-button secondary" to={`/console?agent=${a.id}&scope=local`}>Open private console <ArrowRight size={15}/></Link>:<Link className="nd-button secondary" to={`/vaults?agent=${a.id}`}>Investor profile <ArrowRight size={15}/></Link>}</div></Title><div className="na-tags na-profile-tags"><span>{m.model.id}</span><span>{m.strategy.pair}</span><span>Registered {date(a.createdAt)}</span><span>{a.visibility==='private'?'Private · local owner view':'Public · investor inspection'}</span><span>Measured weights · unsigned local declaration</span></div>{a.exercise&&<p className="nd-notice">{a.exercise.disclosure} Phase: {a.exercise.phase}. The operator requested a 2 virtual USDC buy and full sell. The public strategy is unchanged; this exercise is a separately recorded mandate.</p>}{a.activity.directedFills>0&&<p className="na-note">The earlier registration session includes {a.activity.directedFills} operator-directed paper fills. Latest strategy results are on the investor profile and leaderboard.</p>}{a.activity.manual&&<p className="nd-notice">The earlier session’s paper P&amp;L includes manual scenarios, labeled in its journal.</p>}<div className="nd-metrics">{[['Latest comparison decisions',String(practice?.steps.length??0),`${practice?.steps.filter(s=>s.status==='fill').length??0} hypothetical fills · ${practice?.state??'not started'}`],['Historical paper return',practice?percent(practice.returnBps):'—','USDT · next-bar fills and exit costs'],['Earlier session decisions',String(a.activity.decisions),`${a.activity.fills} paper fills · ${a.activity.directedFills} operator-directed`],['Earlier session paper equity',dollars(a.session.portfolio.equity),'USDC · hypothetical liquidation']].map(([label,value,hint])=><div key={label}><small>{label}</small><strong>{value}</strong><p>{hint}</p></div>)}</div><div className="na-profile-grid"><section className="nd-card na-detail"><div className="nd-eyebrow">IDENTITY & INFERENCE</div><h2>Who controls it. Where it runs.</h2><Facts rows={[["Agent name",m.name],["Declared controller",m.controller],["Model identifier",m.model.id],["Exact weights file",m.model.filename],["Quantization",m.model.quantization],["Weights size",`${m.model.bytes.toLocaleString()} bytes`],[m.inference.runtime==='clef-mlx'?"Model bundle commitment SHA-256":"Weights SHA-256",<code key="weights">{m.model.sha256}</code>],["Inference policy","Downloaded weights · self-hosted only · no hosted fallback"],["Runtime & context",`${m.inference.runtime} · ${m.inference.context.toLocaleString()} tokens · one model at a time`],["Execution authority","Paper proposals only. No signing keys available to the model."],["Hardware attestation","None. Checksums establish artifact consistency only."]]}/></section><section className="nd-card na-detail"><div className="nd-eyebrow">STRATEGY & MANDATE</div><h2>What it does. What it can spend.</h2><Facts rows={[[a.visibility==='private'?"Private strategy":"Published strategy",m.strategy.description],["Proposed market",m.strategy.pair],["Research history",data.market?`${data.market.count} closed hourly observations. Live inputs use 12 recent hours, 14 daily aggregates and a full-range summary; historical comparisons use 24 hours and up to 30 daily aggregates.`:'Market history has not been fetched yet.'],["Per-trade cap",`${dollars(m.strategy.tradeCap)} USDC`],["Allocated-cost exposure cap",`${dollars(m.strategy.exposureCap)} USDC`],["UTC gross turnover cap",`${dollars(m.strategy.dailyTurnoverCap)} USDC`],["Slippage",`${m.strategy.slippageBps} basis points`],["Decision interval",`${m.strategy.intervalMs/1000} seconds`],["External dependencies",`Binance NEAR/USDT market history; 1Click USDC/wNEAR dry-run quotes; local ${m.inference.runtime} inference.`],["Network & fund flow",m.mode],["Rejected live cycles",String(a.activity.blocked)]]}/></section></div><section className="nd-card na-detail"><details><summary className="na-account-summary">Inspect earlier paper portfolio</summary><Facts rows={[["Starting balance",`${dollars(a.session.config.initialCash)} USDC`],["Cash",`${dollars(a.session.portfolio.cash)} USDC`],["Position",`${(Number(a.session.portfolio.position)/1e24).toFixed(6)} wNEAR`],["Allocated purchase cost",`${dollars(a.session.portfolio.cost)} USDC`],["Realized P&L",`${dollars(a.session.metrics.realized)} USDC`],["Unrealized P&L",`${dollars(a.session.metrics.unrealized)} USDC`],["Earlier paper return",liveReturn(a)],["Observed maximum drawdown",`${(a.session.portfolio.maxDrawdownBps/100).toFixed(2)}%`],["Current valuation",a.session.valuationStale?'Stale · refresh in the agent workbench':a.session.portfolio.markAt?date(a.session.portfolio.markAt):'Starting cash · no position'],["Gross UTC turnover",`${dollars(a.session.turnover.used)} USDC · ${a.session.turnover.day||'no trades yet'}`],["Linked clearing account",a.session.testnet?.account??'No testnet deposit linked; virtual balance only'],["Journal head",a.session.head??'No live events recorded yet']]}/></details></section><section className="nd-card na-detail"><div className="nd-card-top"><div><div className="nd-eyebrow">REVIEW & EXPORT</div><h2>A versioned deployment declaration.</h2></div><button className="nd-button secondary" onClick={()=>download(`${m.name}-manifest.json`,{manifest:m,commitment:a.commitment})}><Download size={15}/>{a.visibility==='private'?'Export manifest':'Public manifest'}</button></div><Facts rows={[["Agent ID",a.id],["Manifest version",m.version],["Manifest SHA-256",<code key="commitment">{a.commitment}</code>],["Paper session ID",a.sessionId],["Evidence level",m.evidence],["Recorded live activity",a.activity.firstAt?`${date(a.activity.firstAt)} → ${date(a.activity.lastAt!)}`:'No live model decisions recorded yet.']]}/></section><LiveJournal sessionId={a.sessionId} sequence={a.session.sequence} api={api}/><section className="nd-card na-comparison"><div className="nd-eyebrow">HISTORICAL PRACTICE & COMPARISON</div><h2>Follow the decisions and outcomes.</h2><Comparison data={data} agentId={a.id}/></section></>;
}
function Evidence({data,api}:Pick<Props,'data'|'api'>){const [error,setError]=useState(''),[busy,setBusy]=useState(false);return <><Title eyebrow="EVIDENCE EXPLORER" title="Trust has a source. Follow the record." body="Inspect local model declarations, historical comparisons and paper accounting. Every record carries its environment and verification boundary."/><div className="nd-card na-detail"><h2>Market observations</h2>{data?.market?<Facts rows={[["Source",`${data.market.source} · ${data.market.symbol}`],["Dataset SHA-256",data.market.id],["Coverage",`${data.market.count} closed hourly candles · ${date(data.market.from)} → ${date(data.market.through)}`],["Freshness",data.market.stale?'Stale. Refresh before a new live model decision.':`Captured ${date(data.market.capturedAt)}`],["Execution boundary","Research candles are exchange NEAR/USDT prices. Live paper fills use separate fresh USDC/wNEAR Intents dry-run quotes."]]}/>:<p className="na-note">No market dataset saved yet.</p>}<button className="nd-button secondary" disabled={busy} onClick={()=>{setBusy(true);void api('/market-history').then(()=>window.location.reload()).catch(e=>{setError(e.message);setBusy(false);});}}><RefreshCw size={14}/>Refresh market history</button>{error&&<p role="alert" className="nd-alert">{error}</p>}</div><section className="nd-card na-comparison"><h2>Shared historical comparisons</h2><Comparison data={data}/></section><div className="na-note">Each agent profile exports the exact manifest, input snapshots, decision responses, hash-linked comparison steps, raw market dataset and replay-checked paper journal. Local measurements are not independent proof of execution. No fabricated trade history is substituted for missing model decisions.</div></>;}
