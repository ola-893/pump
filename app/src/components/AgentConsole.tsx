import { hostedApp } from '../lib/hosting';
import { routeStrategyTemplates } from '../lib/route-strategy-templates';
import { AgentSeedBalance, AgentSeedFunding } from './AgentSeedFunding';
import { seedFactory } from '../lib/seed-factory-config';
import { strategySeedFactory } from '../lib/strategy-seed-factory-config';
import { finishBrowserStrategy, prepareBrowserStrategy, type FundingDraft } from '../lib/browser-workspace';
import type { SeedVault } from '../lib/seed-vault';
import { paperAmount, paperAmountInput, parsePaperAmount } from '../lib/paper-amount';
import { paperValuation, type LastPaperValuation } from '../lib/paper-valuation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowRight, Check, Cpu, Download, Play, Plus, RefreshCw, Save, Search, Settings2, Square, Terminal, Activity, AlertTriangle, ShieldCheck } from 'lucide-react';
import { markets, paperMarket, type Config, type Event, type Session, type Proposal, type MarketId, type MarketAsset, type MarketSelection } from '../../../near-demo/types';
import './AgentConsole.css';
import { BrowserInferenceProgress } from './BrowserInferenceProgress';
import type { InferenceProgress } from '../lib/browser-inference-progress';
import { StrategyVaultUpgrade } from './StrategyVaultUpgrade';
import { AgentVisibility } from './AgentVisibility';
import { CreatorAgents, AgentBackLink } from './AgentCollections';
import { collectionLink, matchesController } from '../lib/agent-collection';
import type { WalletPlan } from '../../../near-demo/types';
import { sendDeploymentPlan } from '../lib/vault-deployment-wallet';
import { useNearWallet, NearWalletButton } from './NearWalletProvider';
export type ConsoleAgent={seedVault?:SeedVault;strategyVaults?:SeedVault[];publicationPending?:boolean;publicSyncError?:string;visibility?:'private'|'public';id:string;createdAt?:string;modelRevalidatedAt?:string|null;manifest:{inference?:{runtime:string};name:string;controller?:string;strategy?:{description:string};model:{id:string;quantization:string}};session:{config:Config}};
type SessionView=Session&{lastValuation?:LastPaperValuation|null;valuationStale:boolean;error:string|null;metrics:{total:string|null;realized:string;unrealized:string|null;returnBps:number|null}};
export type ConsoleRun={archived?:boolean;id:string;agentId:string;version:number;label:string;createdAt:string;commitment:string;sessionId:string;config:Config;session:SessionView;activity:{operatorExits?:number;decisions:number;buys:number;sells:number;fills:number;holds:number;blocked:number;volume:string;latest:{at:string;proposal?:Proposal}|null}};
export type ConsoleExecution={activeId:string|null;queued:string[];runtimeBusy?:boolean;otherTabBusy?:boolean;otherTabRunId?:string};
type Props={vaultFactoryReady?:boolean;pendingStrategyAgents?:string[];strategyFundingDrafts?:FundingDraft[];vaults?:{liveNav?:boolean;agentId:string;runId:string;contractId:string|null}[];agents:ConsoleAgent[];runs:ConsoleRun[];execution:ConsoleExecution;runtime:{phase:string;progress?:InferenceProgress};unavailable:boolean;api:(path:string,body?:unknown)=>Promise<any>;refresh:()=>Promise<void>};
const candleTemplates=[{name:'Momentum',strategy:'Trade unleveraged spot using trend momentum. Enter only when recent closed hourly candles show a sustained upward trend supported by increasing volume. Choose position size using observed volatility and the supplied limits. Reduce or exit when momentum weakens or the trend breaks. HOLD when there is no clear signal; do not trade just to increase activity.'},{name:'Mean reversion',strategy:'Trade unleveraged spot using mean reversion. Look for unusually sharp declines relative to recent closed hourly prices, then require stabilization before entering. Size conservatively when volatility is high. Reduce or exit as price recovers toward its recent average, or when the decline resumes. HOLD in persistent downtrends and when evidence of stabilization is weak.'},{name:'Breakout',strategy:'Trade unleveraged spot using confirmed breakouts. Use supplied closed hourly candles to identify a recent consolidation range. Enter only after a close above that range with stronger volume; select a size that respects volatility and the supplied caps. Reduce or exit if the breakout fails or upward follow-through weakens. HOLD inside the range or without confirmation.'}];
function download(name:string,bundle:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function AgentConsole(props:Props){
  const location=useLocation(),[params,setParams]=useSearchParams(),wallet=useNearWallet(),requested=params.get('agent'),agent=props.agents.find(a=>a.id===requested);
  const scope=params.get('scope')??(wallet.account?'mine':'local');
  const collectionParams=new URLSearchParams(params);
  collectionParams.delete('publication');
  const back=collectionLink('/console',collectionParams);
  if(!requested)return <CreatorAgents agents={props.agents} runs={props.runs} onOpen={id=>{const next=new URLSearchParams(collectionParams);next.set('agent',id);next.set('scope',scope);setParams(next);window.scrollTo(0,0);}}/>;
  if(!agent)return <><AgentBackLink to={back}>Back to my agents</AgentBackLink><div className="nd-card ag-empty"><h1>Agent not found in this workspace.</h1><p>Return to your agents or explore the public catalog.</p><Link to="/vaults" className="nd-button">Explore agents</Link></div></>;
  if(scope==='mine'&&!matchesController(agent.manifest.controller,wallet.account))return <><AgentBackLink to={back}>Back to my agents</AgentBackLink><div className="nd-card ag-switch-note"><h1>This agent is outside this wallet view.</h1><p>Connected-wallet workspaces match the controller declared at registration. Open the local workspace to manage this registration.</p>{!wallet.account&&<NearWalletButton/>}{agent.visibility!=='private'&&<Link className="nd-button secondary" to={`/vaults?agent=${agent.id}`}>Public profile</Link>}<Link className="nd-button secondary" to={`/console?agent=${agent.id}&scope=local`}>Open local workspace</Link></div></>;
  const Heading=location.pathname==='/console'?'h1':'h2';
  return <><div className="ag-detail-top"><AgentBackLink to={back}>Back to my agents</AgentBackLink><span className="ag-detail-creator">Controller: {agent.manifest.controller??'Undeclared'} · {scope==='local'?'Local workspace':'Connected wallet'}</span></div><section className="nd-card ac-console" id="agent-console" aria-labelledby="agent-console-title"><div className="nd-card-top"><div><div className="nd-eyebrow">YOUR AGENT WORKSPACE</div><Heading id="agent-console-title"><Terminal size={23}/>{agent.manifest.name} · Agent console</Heading><p>Configure this agent’s strategy, control its sessions, and inspect every decision.</p></div><span className="nd-pill">Local inference · paper trading</span></div><AgentVisibility key={agent.id+agent.visibility} agent={agent} resumePublication={params.get('publication')==='pending'} runs={props.runs} deployed={!!props.vaults?.find(v=>v.agentId===agent.id)?.contractId} api={props.api} refresh={props.refresh}/><AgentWorkspace key={agent.id} {...props} agent={agent} scope={scope}/></section></>;
}
function AgentWorkspace({agent,scope,...props}:Props&{agent:ConsoleAgent;scope:string}){
  const [chosen,setChosen]=useState(''),[fresh,setFresh]=useState(false),[funding,setFunding]=useState<FundingDraft>();
  const versions=props.runs.filter(r=>r.agentId===agent.id).sort((a,b)=>b.version-a.version),run=fresh?undefined:versions.find(r=>r.id===chosen)??versions[0];
  const selectedVault=agent.strategyVaults?.find(vault=>vault.strategyId===run?.id);
  const pendingFunding=props.strategyFundingDrafts?.find(draft=>draft.vault.agentId===agent.id);
  const factory=funding?.vault.factoryId===strategySeedFactory.id?strategySeedFactory:seedFactory;
  const selectedFactory=selectedVault?.factoryId===strategySeedFactory.id?strategySeedFactory:seedFactory;
  if(funding&&factory)return <AgentSeedFunding key={funding.vault.contractId} draft={funding} factory={factory} revision onBack={()=>setFunding(undefined)} onFinish={async()=>{
    const active=await finishBrowserStrategy(funding,factory);
    setFunding(undefined);setChosen(active.id);setFresh(false);await props.refresh();
  }}/>;
  return <>{selectedVault&&selectedFactory?<AgentSeedBalance key={selectedVault.contractId} vault={selectedVault} factory={selectedFactory}/>:agent.seedVault&&seedFactory&&<AgentSeedBalance key={agent.seedVault.contractId} vault={agent.seedVault} factory={seedFactory}/>}
    {selectedVault&&agent.seedVault&&seedFactory&&<details><summary>Original seed vault</summary><AgentSeedBalance key={agent.seedVault.contractId} vault={agent.seedVault} factory={seedFactory}/></details>}
    {pendingFunding&&<button className="nd-button secondary" type="button" onClick={()=>setFunding(pendingFunding)}>Resume strategy vault funding</button>}<div className="ac-version-bar"><div><label htmlFor={`version-${agent.id}`}>Strategy version</label><select id={`version-${agent.id}`} value={run?.id??''} onChange={e=>{setChosen(e.target.value);setFresh(false);}}><option value="" disabled>{fresh?'New strategy draft':'No saved strategies yet'}</option>{versions.map(r=><option key={r.id} value={r.id}>v{r.version} · {r.label}{r.archived?' · Archived':''}</option>)}</select></div><button className="nd-button secondary" type="button" onClick={()=>setFresh(true)}><Plus size={14}/>New strategy</button>{run&&props.vaults?.some(v=>v.agentId===agent.id&&v.runId===run.id&&v.contractId)&&<Link className="nd-text-button" to={`/console?agent=${agent.id}&scope=${encodeURIComponent(scope)}&panel=vault&strategy=${run.id}`}>Manage vault <ArrowRight size={13}/></Link>}<Link className="nd-text-button" to={`/console?agent=${agent.id}&scope=${encodeURIComponent(scope)}&panel=identity`}>Agent identity <ArrowRight size={13}/></Link></div>
    {!hostedApp&&run&&!agent.seedVault&&!run.archived&&!props.vaults?.some(v=>v.runId===run.id&&v.liveNav)&&agent.manifest.controller&&<StrategyVaultUpgrade agentId={agent.id} runId={run.id} owner={agent.manifest.controller} api={props.api} refresh={props.refresh}/>}
    {agent.manifest.inference?.runtime==='clef-mlx'&&<p className="nd-notice">Fixed-choice classifier: selects BUY/HOLD or SELL/HOLD. Pump sizes orders within your saved limits and uses HOLD for uncertain scores. The journal records action scores and policy checks; these are not generated explanations.</p>}<StrategyEditor key={run?.id??'draft'} {...props} agent={agent} run={run} onFund={setFunding} latestVersion={versions[0]?.version??0} onSaved={id=>{setChosen(id);setFresh(false);}}/>
  </>;
}
type Draft={market:MarketId|'catalog';baseAsset?:MarketAsset;quoteAsset?:MarketAsset;label:string;strategy:string;initialCash:string;tradeCap:string;exposureCap:string;dailyTurnoverCap:string;slippageBps:string;interval:string};
function StrategyEditor({agent,run,latestVersion,onSaved,onFund,...props}:Props&{agent:ConsoleAgent;run?:ConsoleRun;latestVersion:number;onSaved:(id:string)=>void;onFund:(draft:FundingDraft)=>void}){
  const wallet=useNearWallet();
  const pending=props.pendingStrategyAgents?.includes(agent.id);
  const fundedBrowser=hostedApp;
  const paperOnly=!fundedBrowser&&(hostedApp||agent.visibility==='private')&&!props.vaults?.some(v=>v.agentId===agent.id);
  const [approval,setApproval]=useState<{plan:WalletPlan;contractId:string;phase:string}>();
  const base=run?.config??agent.session.config;
  const initialMarket=paperMarket(base);
  const initial:Draft={...(typeof base.market==='object'?{market:'catalog' as const,baseAsset:base.market.base,quoteAsset:base.market.quote}:{market:base.market??'near-usdc'}),label:run?.label??'My strategy',strategy:base.strategy,initialCash:paperAmountInput(base.initialCash,initialMarket.quoteDecimals),tradeCap:paperAmountInput(base.tradeCap,initialMarket.quoteDecimals),exposureCap:paperAmountInput(base.exposureCap,initialMarket.quoteDecimals),dailyTurnoverCap:paperAmountInput(base.dailyTurnoverCap,initialMarket.quoteDecimals),slippageBps:String(base.slippageBps),interval:String(base.intervalMs/1000)};
  const draftKey=JSON.stringify(['pump-strategy-draft',agent.id,agent.manifest.controller,run?.id??'new']);
  const [draft,setDraft]=useState<Draft>(() => {
    try {
      const saved=sessionStorage.getItem(draftKey);
      if(saved)return JSON.parse(saved) as Draft;
    } catch {/* Keep editing in memory if session storage is inaccessible. */}
    return initial;
  }),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[events,setEvents]=useState<Event[]>([]),[journalFor,setJournalFor]=useState<number|null>(null),[journalBusy,setJournalBusy]=useState(false),[journalError,setJournalError]=useState(''),[journalAt,setJournalAt]=useState<string|null>(null),[view,setView]=useState(run?'monitor':'strategy');
  const [stopRequested,setStopRequested]=useState(false);
  const [catalog,setCatalog]=useState<MarketAsset[]>([]),[catalogStatus,setCatalogStatus]=useState(''),[route,setRoute]=useState<{key:string;message:string}>();
  const seedQuoteId=agent.seedVault?paperMarket(agent.session.config).quote:undefined;
  const quoteAsset=seedQuoteId
    ? catalog.find(asset=>asset.assetId===seedQuoteId)??(draft.quoteAsset?.assetId===seedQuoteId?draft.quoteAsset:undefined)
    : draft.quoteAsset;
  const selection:MarketSelection|undefined=draft.market!=='catalog'
    ? draft.market
    : draft.baseAsset&&quoteAsset&&draft.baseAsset.assetId!==quoteAsset.assetId?{base:draft.baseAsset,quote:quoteAsset}:undefined;
  const draftMarket=selection?paperMarket({market:selection}):null,runMarket=paperMarket(run?.config);
  const quoteSymbol=draftMarket?.quoteSymbol??quoteAsset?.symbol??'quote currency';
  const quoteDecimals=draftMarket?.quoteDecimals??quoteAsset?.decimals??6;
  const routeKey=JSON.stringify([selection,draft.tradeCap,draft.slippageBps]);
  const startingPoints=hostedApp?routeStrategyTemplates:draft.market==='catalog'?routeStrategyTemplates.slice(0,1):candleTemplates;
  const display=(value:string|null|undefined)=>paperAmount(value,runMarket.quoteDecimals);
  const journalRequest=useRef(0),journalApi=useRef(props.api);journalApi.current=props.api;
  const lock=useRef(false),dirty=JSON.stringify(draft)!==JSON.stringify(initial),session=run?.session;
  const active=!!run&&props.execution.activeId===run.sessionId,queued=!!run&&props.execution.queued.includes(run.sessionId),running=session?.state==='running';
  const {runtimeBusy,otherTabBusy,otherTabRunId}=props.execution;
  const runningElsewhere=!!run&&otherTabRunId===run.id;
  const occupied=active||queued||running||runningElsewhere;
  useEffect(()=>{
    try {
      if(dirty)sessionStorage.setItem(draftKey,JSON.stringify(draft));
      else sessionStorage.removeItem(draftKey);
    } catch {/* Editing and strategy saves still work without session storage. */}
  },[dirty,draft,draftKey]);
  const field=(key:keyof Draft,value:string)=>setDraft(d=>({...d,[key]:value}));
  async function loadCatalog() {
    if(catalogStatus==='Loading 1Click assets…')return;
    setCatalogStatus('Loading 1Click assets…');
    try {
      const result=await props.api('/intent-assets') as {assets:MarketAsset[]};
      setCatalog(result.assets.slice().sort((a,b)=>a.symbol.localeCompare(b.symbol)||a.blockchain.localeCompare(b.blockchain)||a.assetId.localeCompare(b.assetId)));
      setCatalogStatus('');
    } catch(e) {setCatalogStatus((e as Error).message);}
  }
  function chooseMarket(market:Draft['market']) {
    setDraft(d=>({...d,market,...(!seedQuoteId&&market!=='catalog'&&d.market==='catalog'?{initialCash:'',tradeCap:'',exposureCap:'',dailyTurnoverCap:''}:{})}));
    if(market==='catalog'&&!catalog.length)void loadCatalog();
  }
  function chooseAsset(key:'baseAsset'|'quoteAsset',id:string) {
    const asset=catalog.find(a=>a.assetId===id);
    setDraft(d=>({...d,[key]:asset,...(key==='quoteAsset'&&asset?.assetId!==d.quoteAsset?.assetId?{initialCash:agent.seedVault?d.initialCash:'',tradeCap:'',exposureCap:'',dailyTurnoverCap:''}:{})}));
  }
  async function checkRoute() {
    if(lock.current||!selection||typeof selection!=='object')return;
    lock.current=true;setBusy('route');setRoute(undefined);
    try {
      await props.api('/intent-market-check',{market:selection,amount:parsePaperAmount(draft.tradeCap,quoteDecimals),slippageBps:Number(draft.slippageBps)});
      setRoute({key:routeKey,message:'Signed buy and sell quotes verified at this order size.'});
    } catch(e) {setRoute({key:routeKey,message:(e as Error).message});}
    finally {lock.current=false;setBusy('');}
  }
  async function applyDeployment(result:any) {
    if (result.phase==='active') {
      setApproval(undefined);
      setDraft(initial);
      try{sessionStorage.removeItem(draftKey);}catch{/* The saved version is already durable. */}
      await props.refresh();
      onSaved(result.run.id);
      return;
    }
    setApproval(result);
  }
  async function deploymentTask(work:()=>Promise<void>) {
    if(lock.current)return;
    lock.current=true;
    setBusy('save');
    setError('');
    try{await work();}catch(e){setError((e as Error).message);}
    finally{lock.current=false;setBusy('');}
  }
  async function save(){
    await deploymentTask(async()=>{
      if(!paperOnly&&wallet.account!==agent.manifest.controller)throw new Error('Connect the agent owner’s NEAR testnet wallet.');
      if(!draft.label.trim()||draft.strategy.trim().length<20)throw new Error('Name the strategy and describe entry, exit, sizing and HOLD conditions.');
      if(!selection)throw new Error('Choose the base and quote assets.');
      const parse=(value:string)=>parsePaperAmount(value,quoteDecimals);
      const settings={market:selection,label:draft.label,strategy:draft.strategy,initialCash:fundedBrowser?parse(draft.initialCash):agent.seedVault?.amount??parse(draft.initialCash),
        tradeCap:parse(draft.tradeCap),exposureCap:parse(draft.exposureCap),dailyTurnoverCap:parse(draft.dailyTurnoverCap),
        slippageBps:Number(draft.slippageBps),intervalMs:Number(draft.interval)*1000};
      if(fundedBrowser){onFund(await prepareBrowserStrategy(agent.id,latestVersion,settings));await props.refresh();return;}
      const saveRequest={agentId:agent.id,expectedVersion:latestVersion,settings};
      const result=paperOnly
        ? await props.api('/strategy-save-paper',saveRequest)
        : await props.api('/strategy-save',{...saveRequest,account:wallet.account});
      await applyDeployment(result);
    });
  }
  async function resume(){
    await deploymentTask(async()=>applyDeployment(await props.api('/strategy-deployment',{agentId:agent.id})));
  }
  async function approve(){
    if(!approval)return;
    await deploymentTask(async()=>{
      // Observe again before signing so a wallet that finished elsewhere cannot prompt another deployment.
      const current=await props.api('/strategy-deployment',{agentId:agent.id});
      if(current.phase!==approval.phase){await applyDeployment(current);return;}
      await sendDeploymentPlan(current.plan,wallet.account,agent.id);
      for(let attempt=0;attempt<7;attempt++){
        const result=await props.api('/strategy-deployment',{agentId:agent.id});
        const progressed=result.phase!==current.phase||result.plan?.receiverId!==current.plan.receiverId;
        if(result.phase==='active'||progressed&&(current.phase!=='deploy'||attempt>=3)){
          await applyDeployment(result);return;
        }
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      throw new Error('Testnet has not confirmed this step. Check wallet history and use Check deployment.');
    });
  }
  async function action(action:string){if(!run||lock.current&&action!=='stop')return;const stopping=action==='stop';if(!stopping){lock.current=true;setBusy(action);}setError('');setNotice('');setStopRequested(false);try{const {session:result,cancelled}=await props.api('/strategy-action',{runId:run.id,action});await props.refresh();
    if(cancelled)return;
    if(stopping&&hostedApp){setStopRequested(true);return;}
    if((action==='mark'||action==='cycle')&&result?.error){setError(result.error);return;}
    if(action==='mark'&&result?.valuationStale){setError('Current paper equity is unavailable. Try refreshing the portfolio quote again.');return;}
    setNotice(action==='stop'?'Stopped future decisions. An active decision may finish; stopping does not sell an open position.':action==='start'?'':action==='cycle'?'Decision completed. See the outcome and journal below.':'Portfolio valuation refreshed.');}catch(e){setError((e as Error).message);}finally{if(!stopping){lock.current=false;setBusy('');}}}
  const runId=run?.id;
  const inspect=useCallback(async()=>{
    if(!runId)return false;
    const request=++journalRequest.current;
    setJournalBusy(true);
    try{
      const r=await journalApi.current('/strategy-history',{runId});
      if(request!==journalRequest.current)return false;
      setEvents(r.events);
      // Use the returned journal cursor: a decision can finish after the status read.
      setJournalFor(r.events.at(-1)?.sequence??0);
      setJournalError('');
      setJournalAt(new Date().toISOString());
      return true;
    }catch(e){if(request===journalRequest.current)setJournalError((e as Error).message);return false;}
    finally{if(request===journalRequest.current)setJournalBusy(false);}
  },[runId]);
  useEffect(()=>{
    if(!runId)return;
    let disposed=false,retry:ReturnType<typeof setTimeout>|undefined;
    const read=async()=>{
      const loaded=await inspect();
      if(!disposed&&!loaded)retry=setTimeout(()=>void read(),5000);
    };
    void read();
    // Ignore late responses after another version/sequence is selected or unmounted.
    return()=>{disposed=true;clearTimeout(retry);++journalRequest.current;};
  },[runId,run?.session.sequence,inspect]);
  async function exportRun(){if(!run)return;setError('');try{const r=await props.api('/strategy-export',{runId:run.id});download(`${agent.manifest.name}-strategy-v${run.version}.json`,r.bundle);}catch(e){setError((e as Error).message);}}
  const input=(key:Exclude<keyof Draft,'market'|'baseAsset'|'quoteAsset'>,label:string,hint?:string)=><label>{label}<input value={draft[key]} onChange={e=>field(key,e.target.value)} disabled={!!busy||occupied} inputMode={key==='label'?'text':'decimal'} maxLength={key==='label'?80:38}/>{hint&&<small>{hint}</small>}</label>;
  const otherVersion=props.runs.find(r=>r.agentId===agent.id&&r.id!==run?.id&&(r.id===otherTabRunId||r.session.state==='running'||props.execution.activeId===r.sessionId||props.execution.queued.includes(r.sessionId)));
  const queuePosition=run?props.execution.queued.indexOf(run.sessionId)+1:0;
  const shownEvents=events.filter(e=>['model','fill','blocked','dust'].includes(e.kind));
  const latestEvent=shownEvents.at(-1);
  const repairedBlock=latestEvent?.kind==='blocked'&&/^Registered weights changed/.test(latestEvent.reason)&&!!agent.modelRevalidatedAt&&Date.parse(agent.modelRevalidatedAt)>Date.parse(latestEvent.at);
  const blockedEvent = latestEvent?.kind==='blocked'&&!repairedBlock ? latestEvent : undefined;
  const legacyQuoteFailure = blockedEvent?.reason==='fetch failed'&&!blockedEvent.quote;
  const quoteFailure = legacyQuoteFailure || blockedEvent?.reason.startsWith('Could not reach NEAR Intents 1Click');
  const laterSignedMark = quoteFailure && blockedEvent && events.some(event =>
    event.sequence > blockedEvent.sequence && event.kind==='mark' && event.quote?.signatureVerified
  );
  const lastFailure = session?.error ?? (laterSignedMark ? null : legacyQuoteFailure
    ? 'The initial 1Click dry-run quote request failed before the model ran.'
    : blockedEvent?.reason);
  const failureTitle = session?.error && !blockedEvent ? 'Portfolio or worker needs attention' : 'Last decision attempt was blocked';
  const stopping=active&&props.runtime.phase==='stopping';
  const status=runningElsewhere?'Running in another tab':stopping?'Stopping':active?props.runtime.phase==='loading'?'Loading model':'Evaluating market':queued?'Queued':running&&lastFailure?'Needs attention':running?'Waiting for next decision':run?'Stopped':'Not configured';
  const valuation = session&&run?paperValuation(session,run.config.initialCash):null;
  const lastValuation = valuation?.stale?valuation:undefined;
  const equity = valuation?.equity;
  const pnl = valuation?.total;
  const journal=<ConsoleJournal events={shownEvents} loaded={journalFor!==null} busy={journalBusy} at={journalAt} behind={journalFor!==null&&!!run&&journalFor<run.session.sequence} refresh={()=>void inspect()}/>;
  return <>
    <section className="ac-control-bar" aria-label="Agent run controls"><div className="ac-control-state"><span className={'ac-state-icon '+(lastFailure?'attention':'')} aria-hidden="true">{lastFailure?<AlertTriangle size={20}/>:<Activity size={20}/>}</span><div><span className="ac-overline">{run?`STRATEGY v${run.version}`:'STRATEGY DRAFT'}</span><h3>{run?.archived?'Archived':status}</h3><p>{run?.archived?'This version is preserved for inspection. The agent uses the latest active strategy.':runningElsewhere?'Switch to the tab running this strategy to stop it.':stopping?'Finishing cleanup before another run can start.':active?'The local model is evaluating this portfolio.':queued?`Position ${queuePosition} in the shared model queue.`:running?'Scheduling is enabled. Decisions are recorded only after validation.':otherTabBusy?'A paper session in another tab is using the browser runtime.':runtimeBusy?'Another paper session is running in this tab.':run?'Start a continuous session or evaluate the market once.':'Save a strategy before starting this agent.'}</p></div></div><div className="ac-run-buttons"><button type="button" className="nd-button" disabled={!run||run.archived||dirty||!!busy||occupied||!!otherVersion||props.unavailable||runtimeBusy} onClick={()=>void action('start')}><Play size={15}/>Start agent</button><button type="button" className="nd-button secondary" disabled={!run||run.archived||dirty||!!busy||occupied||!!otherVersion||props.unavailable||runtimeBusy} onClick={()=>void action('cycle')}><ArrowRight size={15}/>{busy==='cycle'?'Evaluating…':'Run once'}</button><button type="button" className="nd-button secondary ac-stop" disabled={!run||!occupied||stopping||runningElsewhere} onClick={()=>void action('stop')}><Square size={14}/>Stop</button></div></section>
    {active&&props.runtime.progress&&<BrowserInferenceProgress progress={props.runtime.progress}/>}
    {lastFailure&&<div className="ac-blocker" role="alert"><AlertTriangle size={18}/><div><strong>{failureTitle}</strong><p>{lastFailure}</p><small>{blockedEvent&&`${new Date(blockedEvent.at).toLocaleString()} · `}{occupied?'Scheduling may still be enabled.':'The scheduler is stopped.'}</small></div>{/^Registered weights changed/.test(lastFailure)?<Link className="nd-text-button" to={`/console?agent=${agent.id}&scope=local&panel=identity`}>Inspect agent identity <ArrowRight size={13}/></Link>:<button type="button" className="nd-text-button" onClick={()=>setView('journal')}>Inspect decision journal <ArrowRight size={13}/></button>}</div>}
    {props.unavailable&&<p className="nd-alert">Stop legacy execution practice or the historical comparison before starting a strategy.</p>}
    {otherVersion&&<div className="ac-draft-warning">Another version of this agent is active: v{otherVersion.version} · {otherVersion.label}. <button type="button" className="nd-text-button" onClick={()=>onSaved(otherVersion.id)}>Select active version</button></div>}
    {dirty&&run&&<div className="ac-draft-warning">Unsaved strategy edits. Save a new version before starting these settings. <button type="button" className="nd-text-button" onClick={()=>setView('strategy')}>Review edits</button></div>}
    {(error||journalError)&&<p role="alert" className="nd-alert">{error||journalError}</p>}{notice&&<p role="status" className="nd-notice">{notice}</p>}
    {stopRequested&&<p role="status" className="nd-notice">{occupied?'Stop requested.':'Agent stopped.'} Open paper positions are kept.</p>}
    <div className="ac-view-tabs" role="group" aria-label="Console views">{[['monitor','Monitor',Activity],['strategy','Strategy & limits',Settings2],['journal','Decision journal',Terminal]].map(([key,label,Icon])=><button key={String(key)} type="button" aria-pressed={view===key} disabled={!run&&key!=='strategy'} title={!run&&key!=='strategy'?'Save a strategy to inspect its activity.':undefined} onClick={()=>setView(String(key))}>{typeof Icon!=='string'&&<Icon size={14}/>} {String(label)}{key==='journal'&&run&&<span>{run.activity.decisions+run.activity.fills+run.activity.blocked}</span>}</button>)}{run&&<span className="ac-auto-sync">Auto-refresh · 5s</span>}</div>
    {(approval||pending)&&<section className="nd-notice" aria-label="Strategy vault deployment">
      <h3>{approval?.plan.description??'Strategy vault setup is pending'}</h3>
      {approval&&<p>Vault {approval.contractId}. Approval wallet {approval.plan.signerId}.
        {approval.phase==='deploy'&&<> Fund the vault with {Number(approval.plan.actions[0].params.deposit)/1e24} test NEAR plus network gas.</>}
        {approval.phase==='archive'&&<> The previous vault must close to new deposits before this strategy can go live.</>}
      </p>}
      <div className="nd-buttons">
        {approval&&(wallet.account===approval.plan.signerId
          ? <button type="button" className="nd-button" disabled={!!busy} onClick={()=>void approve()}>Approve in wallet</button>
          : <NearWalletButton/>)}
        <button type="button" className="nd-button secondary" disabled={!!busy} onClick={()=>void resume()}>Check deployment</button>
      </div>
    </section>}
    {view==='strategy'?<div className="ac-config-layout"><form className="ac-editor" onSubmit={e=>{e.preventDefault();void save();}}><div className="ac-section-title"><span>CONFIGURE</span><h3>{run?`v${run.version} · ${run.label}`:'Define a strategy for '+agent.manifest.name}</h3></div><p className="ac-help">{run?'Saved versions are immutable. Changes create a fresh, stopped portfolio; earlier results stay intact.':'Define entries, exits, sizing and when to HOLD. Saving does not run the agent.'}</p>
            {input('label','Strategy name')}
      <label>Paper trading market<select value={draft.market} disabled={!!busy||occupied||pending} onChange={e=>chooseMarket(e.target.value as Draft['market'])}>
        {Object.entries(markets).map(([id,market])=><option key={id} value={id} disabled={!!seedQuoteId&&market.quote!==seedQuoteId}>{market.label}</option>)}
        <option value="catalog">Choose from all 1Click assets</option>
      </select></label>
      {draft.market==='catalog'&&<><div className="ac-fields">{(['baseAsset','quoteAsset'] as const).map(key=>{
        const isBase=key==='baseAsset';
        const selected=isBase?draft.baseAsset:quoteAsset;
        const assets=catalog.filter(asset=>isBase?asset.assetId!==(quoteAsset?.assetId??seedQuoteId):
          seedQuoteId?asset.assetId===seedQuoteId:asset.assetId!==draft.baseAsset?.assetId);
        return <label key={key}>{isBase?'Base asset':'Quote currency'}<select disabled={!!busy||occupied||pending||!catalog.length||(!isBase&&!!seedQuoteId)} value={selected?.assetId??''} onChange={e=>chooseAsset(key,e.target.value)}>
          <option value="">Select asset</option>
          {selected&&!assets.some(asset=>asset.assetId===selected.assetId)&&<option value={selected.assetId}>{selected.symbol} · {selected.blockchain}</option>}
          {assets.map(asset=><option key={asset.assetId} value={asset.assetId} title={asset.assetId}>{asset.symbol} · {asset.blockchain} · {asset.assetId}</option>)}
        </select></label>;
      })}</div>
      {!catalog.length&&<button type="button" className="nd-button secondary" disabled={catalogStatus==='Loading 1Click assets…'} onClick={()=>void loadCatalog()}>Load 1Click assets</button>}
      {catalogStatus&&<p role="status">{catalogStatus}</p>}
      <p className="ac-help">Custom markets use signed route observations. Write rules for those observations. {seedQuoteId?'The seed vault fixes the quote currency to USDC.':!hostedApp?'The testnet USDC vault follows the strategy’s return in its quote currency.':''}</p>
      <button type="button" className="nd-button secondary" disabled={!selection||!!busy||occupied||pending} onClick={()=>void checkRoute()}>{busy==='route'?'Checking both directions…':'Check buy and sell quotes'}</button>
      {route?.key===routeKey&&<p role="status">{route.message}</p>}</>}
      <label>Trading strategy<textarea rows={9} maxLength={3000} value={draft.strategy} disabled={!!busy||occupied} onChange={e=>field('strategy',e.target.value)}/><small>Instructions go to your local model. {hostedApp||agent.visibility==='private'?'Saved privately on this computer; included in your owner export.':'Saving publishes these instructions for investor inspection.'}{hostedApp?' Base your rules on signed route quotes.':''}</small></label>
      <div className="ac-templates"><span>Starting points</span>{startingPoints.map(t=><button type="button" key={t.name} disabled={!!busy||occupied} onClick={()=>setDraft(d=>({...d,label:t.name,strategy:t.strategy}))}>{t.name}</button>)}</div>
      <div className="ac-section-title ac-limits-title"><span>RISK & CAPITAL</span><h3>Set the boundaries.</h3></div><div className="ac-fields">{agent.seedVault&&!fundedBrowser?<label>Paper starting capital<input value={paperAmountInput(agent.seedVault.amount,6)+' USDC'} readOnly/></label>:input('initialCash',fundedBrowser?'Strategy seed · test USDC':`Starting virtual ${quoteSymbol}`)}{input('tradeCap',`Per-trade cap · ${quoteSymbol}`)}{input('exposureCap',`Allocated-cost cap · ${quoteSymbol}`)}{input('dailyTurnoverCap',`Daily turnover cap · ${quoteSymbol}`)}{input('slippageBps','Slippage · basis points','50 bps = 0.5%')}{input('interval','Decision interval · seconds','15–3,600; queue and inference add time.')}</div>
      <div className="ac-save"><button className="nd-button" type="submit" disabled={!paperOnly&&props.vaultFactoryReady===false||!!busy||!!approval||pending||occupied||!!otherVersion||props.unavailable||!selection||!!run&&!dirty}><Save size={14}/>{busy==='save'?'Checking…':paperOnly?'Save paper strategy':'Save & deploy vault'}</button>{dirty&&<button className="nd-button secondary" type="button" disabled={!!busy||!!approval||pending||occupied} onClick={()=>setDraft(initial)}>Discard edits</button>}<span>{paperOnly?(agent.seedVault?'Saves a paper strategy. Vault funds stay separate.':'Save a private paper portfolio. You can add a testnet vault later.'):props.vaultFactoryReady===false?'Strategy deployment will open after Pump’s vault factory is installed on testnet.':'The owner approves and funds a separate vault on NEAR testnet.'}</span>
        {!paperOnly&&!wallet.account&&<NearWalletButton/>}</div></form>
      <aside className="ac-config-note"><ShieldCheck size={24}/><h3>Your model. Your mandate.</h3><p>Only local inference is used. The model proposes BUY, SELL or HOLD; the paper engine checks amounts, inventory and declared limits before recording a simulated fill.</p><dl><div><dt>Market</dt><dd>{draftMarket?.label??'Choose the base and quote assets'}</dd></div><div><dt>Execution</dt><dd>Live 1Click dry-run quotes</dd></div><div><dt>Local runtime</dt><dd>One model loaded at a time</dd></div><div><dt>Saved state</dt><dd>{run?`Version ${run.version} · ${new Date(run.createdAt).toLocaleDateString()}`:'Unpublished draft'}</dd></div></dl><p>Stop this agent and wait for an active decision to finish before saving another version. A configured exit is evaluated by the model; it is not a continuously enforced stop-loss.</p></aside></div>
    :view==='journal'?<div className="ac-journal-view">{journal}</div>:<div className="ac-monitor"><div className="ac-metrics">{[[lastValuation?`Last quoted equity · ${runMarket.quoteSymbol}`:`Equity · ${runMarket.quoteSymbol}`,equity==null?'—':display(equity)],[lastValuation?`P&L at last quote · ${runMarket.quoteSymbol}`:`Total P&L · ${runMarket.quoteSymbol}`,pnl==null?'—':display(pnl)],['Filled orders',String(run?.activity.fills??0)],['Buys / sells',`${run?.activity.buys??0} / ${run?.activity.sells??0}`],['HOLDs / blocked',`${run?.activity.holds??0} / ${run?.activity.blocked??0}`],[`Volume · ${runMarket.quoteSymbol}`,run?display(run.activity.volume):'0']].map(([label,value])=><div key={label}><small>{label}</small><strong className={label===`Total P&L · ${runMarket.quoteSymbol}`&&pnl!=null?(BigInt(pnl)<0n?'negative':'positive'):''}>{value}</strong></div>)}</div>
      <div className="ac-monitor-grid"><div className="ac-monitor-main">{journal}</div><aside className="ac-monitor-side"><section className="ac-side-card"><div className="nd-eyebrow">LATEST RECORDED MODEL DECISION</div>{run?.activity.latest?<><strong className="ac-decision-action">{run.activity.latest.proposal?.action}</strong><small>{new Date(run.activity.latest.at).toLocaleString()}</small><p>{run.activity.latest.proposal?.reason}</p></>:<p>No model evaluation recorded for this version.</p>}{latestEvent?.kind==='blocked'&&<div className="ac-latest-blocked"><span>{repairedBlock?'Model checksum reverified after this block':laterSignedMark?'A portfolio quote succeeded after this block':'More recent attempt blocked'}</span><small>{new Date(repairedBlock?agent.modelRevalidatedAt!:latestEvent.at).toLocaleString()}</small></div>}</section>
      <section className="ac-side-card"><div className="nd-eyebrow">PAPER PORTFOLIO</div><dl><div><dt>Cash</dt><dd>{session?display(session.portfolio.cash):'—'} {runMarket.quoteSymbol}</dd></div><div><dt>Position</dt><dd>{session?paperAmount(session.portfolio.position,runMarket.decimals):'—'} {runMarket.symbol}</dd></div><div><dt>Realized P&L</dt><dd>{session?display(session.metrics.realized):'—'} {runMarket.quoteSymbol}</dd></div><div><dt>Observed max drawdown</dt><dd>{session?(session.portfolio.maxDrawdownBps/100).toFixed(2):'—'}%</dd></div><div><dt>Valuation</dt><dd>{session?.valuationStale?(lastValuation?`Last quote ${new Date(lastValuation.at).toLocaleString()}`:'No quote available'):session?.portfolio.markAt?new Date(session.portfolio.markAt).toLocaleString():'Starting cash'}</dd></div></dl>{run&&<button type="button" className="nd-text-button" disabled={active||queued||!!busy||runtimeBusy} onClick={()=>void action('mark')}><RefreshCw size={12}/>Refresh portfolio quote</button>}</section>
      <section className="ac-side-card"><div className="nd-eyebrow">EXECUTION CONTEXT</div><dl><div><dt>Minimum interval</dt><dd>{run?run.config.intervalMs/1000:'—'} seconds</dd></div><div><dt>Queue</dt><dd>{queued?`Position ${queuePosition}`:props.execution.queued.length?`${props.execution.queued.length} waiting`:'No queued decisions'}</dd></div><div><dt>Per-order cap</dt><dd>{run?display(run.config.tradeCap):'—'} {runMarket.quoteSymbol}</dd></div><div><dt>Daily turnover cap</dt><dd>{run?display(run.config.dailyTurnoverCap):'—'} {runMarket.quoteSymbol}</dd></div></dl><p>{hostedApp?'Keep this tab open for scheduled decisions. Stop cancels an in-progress evaluation and keeps open paper positions.':'Stop cancels future decisions. An in-flight decision may finish; open positions are kept. Server restarts stop strategy workers.'}</p></section></aside></div>
    </div>}
    <div className="ac-record-footer"><span>{run?`Strategy v${run.version} · separate paper portfolio`:'No saved strategy selected'} · Simulated fills</span>{run&&<button className="nd-text-button" type="button" onClick={()=>void exportRun()}><Download size={13}/>Export strategy evidence</button>}</div><p className="ac-help ac-export-note">Full exports include strategy instructions and raw inference prompts. Review before sharing. Paper returns exclude network gas and setup costs.</p>
  </>;
}
function ConsoleJournal({events,loaded,busy,at,behind,refresh}:{events:Event[];loaded:boolean;busy:boolean;at:string|null;behind:boolean;refresh:()=>void}){
  const [filter,setFilter]=useState('all'),[query,setQuery]=useState('');
  const matches=events.filter(e=>(filter==='all'||e.kind===filter)&&`#${e.sequence} ${e.reason} ${e.action??e.model?.proposal.action??''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const shown=matches.slice(-40).reverse();
  return <section className="ac-live-journal" aria-label="Live decision journal"><div className="ac-journal-heading"><div><div className="nd-eyebrow">LIVE ACTIVITY</div><h3>Decision journal <span className="ac-live-dot"/></h3><p>{at?`Synced ${new Date(at).toLocaleTimeString()} · ${events.length} decision, fill, adjustment and rejection events`:'Connecting to this version’s journal…'}</p></div><button type="button" className="nd-button secondary" disabled={busy} onClick={refresh} aria-label="Refresh journal"><RefreshCw size={13}/><span>{busy?'Syncing…':'Refresh journal'}</span></button></div>
    <div className="ac-log-toolbar"><div role="group" aria-label="Filter decision journal">{[['all','All events'],['model','Decisions'],['fill','Fills'],['blocked','Blocked']].map(([key,label])=><button key={key} type="button" aria-pressed={filter===key} onClick={()=>setFilter(key)}>{label}<span>{key==='all'?events.length:events.filter(e=>e.kind===key).length}</span></button>)}</div><label className="ac-log-search"><Search size={14}/><input value={query} aria-label="Search decision journal" placeholder="Search reason or event #" onChange={e=>setQuery(e.target.value)}/></label></div>
    {behind&&<p className="ac-log-update" role="status">New journal events are syncing…</p>}
    {!loaded?<div className="ac-log-empty">Loading this strategy’s journal…</div>:!shown.length?<div className="ac-log-empty"><Terminal size={23}/><h4>{events.length?'No matching events.':'No decisions yet.'}</h4><p>{events.length?'Try another event filter or search.':'Use Run once or Start agent when this strategy is ready.'}</p></div>:<div className="ac-journal"><table><thead><tr><th>TIME / EVENT</th><th>OUTCOME</th><th>REASON / RECEIPT</th></tr></thead><tbody>{shown.map(e=><tr key={e.hash}><td><time dateTime={e.at}>{new Date(e.at).toLocaleTimeString()}</time><small>{new Date(e.at).toLocaleDateString()} · #{e.sequence}</small></td><td><strong className={'ac-event-label '+e.kind}>{e.kind==='model'?(e.model?`Model ${e.model.proposal.action}`:'Scenario request'):e.kind==='fill'?`Simulated ${e.action} fill`:e.kind==='dust'?'Paper dust adjustment':'Blocked cycle'}</strong></td><td><p>{e.reason}</p><details><summary>Inspect receipt</summary><dl><div><dt>Event hash</dt><dd>{e.hash}</dd></div>{classifierReceipt(e)}{e.quote&&<><div><dt>Quote</dt><dd>{e.quote.id} · {e.quote.source}</dd></div><div><dt>Signature</dt><dd>{e.quote.signatureVerified?'Verified':'Not verified'}</dd></div><div><dt>Quote received</dt><dd>{new Date(e.quote.receivedAt).toLocaleString()}</dd></div></>}</dl></details></td></tr>)}</tbody></table></div>}
    <p className="ac-journal-footnote">Showing {shown.length} of {matches.length} matching events, newest first. Auto-updates every 5 seconds. The complete journal is in the evidence export.</p>
  </section>;
}

function classifierReceipt(e:Event){try{const c=(e.model?.request as {classifier?:{nativeResponse:string}}|undefined)?.classifier;if(!c)return null;const r=JSON.parse(c.nativeResponse),p=r.answers?.action?.probabilities;if(!p)return null;return <><div><dt>Classifier action scores</dt><dd>{Object.entries(p).map(([key,value])=>`${key}: ${Number(value).toFixed(4)}`).join(' · ')}</dd></div><div><dt>Inference time</dt><dd>{r.usage?.latency_ms??'Unavailable'} ms · zero generated tokens</dd></div><div><dt>Decision policy</dt><dd>Minimum score 0.60 · minimum margin 0.10 · code-selected size within saved limits.</dd></div></>;}catch{return null;}}
