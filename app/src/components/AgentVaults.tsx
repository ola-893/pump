import { useEffect,useState,useRef } from 'react';
import { Link,useSearchParams } from 'react-router-dom';
import { RefreshCw,ArrowRight,ShieldCheck,Check } from 'lucide-react';
import type { WalletPlan } from '../../../near-demo/types';
import type { ConsoleRun } from './AgentConsole';
import { useNearWallet } from './NearWalletProvider';
import { sendVaultPlan,type VaultTarget } from '../lib/agent-vault-wallet';
import { InvestorAgentDetails, type InvestorAgent } from './InvestorAgentDetails';
import {runInvestorFlow,type InvestorReceipt} from '../lib/vault-investment';
import './AgentVaults.css';
import { AgentCatalog, AgentBackLink } from './AgentCollections';
import { collectionLink } from '../lib/agent-collection';
export type VaultRow={liveNav?:boolean;archived?:boolean;agentId:string;runId:string;name:string;version:number;strategyHash:string;manifestHash:string;contractId:string|null;network:string;mode:string;controllerId:string;reporterId:string;tokenId:string};
type Props={loading?:boolean;ownerView?:boolean;agents:InvestorAgent[];vaults:VaultRow[];runs:ConsoleRun[];api:(path:string,body?:unknown)=>Promise<any>;refresh:()=>Promise<void>};
const human=(s:string|null|undefined)=>{if(s==null)return '—';const n=BigInt(s);return `${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`;};
const parse=(s:string)=>{if(!/^\d+(?:\.\d{1,6})?$/.test(s))throw new Error('Use up to six decimal places.');const [a,b='']=s.split('.');const n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));if(!n)throw new Error('Enter a positive amount.');return String(n);};
export function AgentVaults({agents,vaults,runs,api,refresh,loading=false,ownerView=false}:Props){
 const [params,setParams]=useSearchParams(),selected=params.get('agent');
 const {account}=useNearWallet();
 const agent=agents.find(a=>a.id===selected&&(ownerView||a.visibility!=='private'));
 const fundingId='investor-vault-'+(selected??'none');
 const fromLeaderboard=params.get('from')==='leaderboard',backParams=new URLSearchParams(params);backParams.delete('from');backParams.delete('strategy');const back=collectionLink(fromLeaderboard?'/evidence':'/vaults',backParams),backLabel=fromLeaderboard?'Back to leaderboard':'Back to explore agents';
 useEffect(()=>{if(selected)window.scrollTo(0,0);},[selected]);
 if(loading)return <p role="status">Loading agents…</p>;
 if(!selected)return <AgentCatalog agents={agents} runs={runs} vaults={vaults}/>;
 if(!agent)return <><AgentBackLink to={back}>{backLabel}</AgentBackLink><div className="nd-card ag-empty"><h1>Agent not found.</h1><p>This agent is not available in the current registry.</p></div></>;
 if(agent.visibility==='private'&&!ownerView)return <><AgentBackLink to={`/console?agent=${agent.id}&scope=local`}>Back to private console</AgentBackLink><div className="nd-card ag-switch-note"><h1>Private agent</h1><p>Publish this agent and its strategy before accepting investor deposits.</p></div></>;
 const agentRuns=runs.filter(r=>r.agentId===agent.id);
 const requestedRun=params.get('strategy');
 const run=requestedRun ? agentRuns.find(r=>r.id===requestedRun) : [...agentRuns].sort((a,b)=>b.version-a.version)[0];
 if(requestedRun&&!run)return <><AgentBackLink to={back}>{backLabel}</AgentBackLink><div className="nd-card ag-empty"><h1>Strategy version unavailable.</h1><p>Choose an available strategy version before investing.</p><Link className="nd-button secondary" to={collectionLink('/vaults',backParams,agent.id)}>View agent strategies</Link></div></>;
 const archivedVaults=vaults.filter(v=>v.agentId===agent.id&&v.archived&&v.contractId);
 const currentRun=agentRuns.find(r=>!r.archived&&r.id!==run?.id);
 const v=vaults.find(v=>v.agentId===agent.id&&v.runId===run?.id&&v.strategyHash===run?.commitment);
 const selectRun=(runId:string)=>{
  const next=new URLSearchParams(params);
  next.set('strategy',runId);
  setParams(next,{replace:true});
 };
 const investment=v?.contractId
  ? <VaultWorkspace fundingId={fundingId} manage={ownerView} key={JSON.stringify([v.runId,v.contractId,account])}
      v={v} account={account} run={run!} api={api} refresh={refresh} privateAgent={agent.visibility==='private'}/>
  : <section className="nd-card av-invest-cta ag-switch-note" id={fundingId} aria-label="Investment availability">
      <div className="nd-eyebrow">NEAR TESTNET</div><h2>Investments are not open yet.</h2>
      <p>{run ? `Strategy v${run.version} has no investment vault yet.` : 'This agent has no saved strategy to invest in.'} Each investable strategy version has its own vault and pump coin.</p>
    </section>;
 return <><div className="ag-detail-top"><AgentBackLink to={back}>{backLabel}</AgentBackLink><span className="ag-detail-creator">Created by {agent.manifest.controller}</span></div>
 {run?.archived&&<div className="nd-notice"><strong>Archived strategy v{run.version}</strong>
   <p>{agent.manifest.name} now uses {currentRun?`v${currentRun.version} · ${currentRun.label}`:'a newer strategy'}. {v?.contractId&&' Withdraw any balance from this version’s original vault.'}</p>
   {currentRun&&<button type="button" className="nd-text-button" onClick={()=>selectRun(currentRun.id)}>View active strategy <ArrowRight size={13}/></button>}
 </div>}
 {!run?.archived&&archivedVaults.length>0&&<div className="nd-notice">
   <strong>Previous strategy vaults</strong><p>Withdraw from the version you originally invested in.</p>
   <div className="nd-buttons">{archivedVaults.map(vault=><button className="nd-button secondary" key={vault.runId} type="button" onClick={()=>selectRun(vault.runId)}>v{vault.version} · Archived vault</button>)}</div>
 </div>}
 <InvestorAgentDetails key={'profile-'+agent.id} agent={agent} runs={agentRuns} run={run} onSelectRun={selectRun} api={api} fundingId={fundingId} investment={investment} investmentReady={!!v?.contractId&&agent.visibility!=='private'} archived={!!run?.archived||!!v&&!v.liveNav}/></>;

}

function VaultWorkspace({v,account,run,api,refresh,fundingId,manage=false,privateAgent=false}:{fundingId:string;manage?:boolean;privateAgent?:boolean;v:VaultRow;account:string;run:ConsoleRun;api:Props['api'];refresh:Props['refresh']}){
 const wallet=useNearWallet();
 const [o,setObservation]=useState<any>(),[error,setError]=useState(''),[observationError,setObservationError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[progress,setProgress]=useState('');
 const [amount,setAmount]=useState(''),[selectedMode,setMode]=useState<'invest'|'withdraw'>('invest'),[operatorAmount,setOperatorAmount]=useState('5'),[plans,setPlans]=useState<WalletPlan[]>([]),[lastHash,setLastHash]=useState('');
 const [receiptQuery,setReceiptQuery]=useState('');
 const [pendingHash,updatePendingHash]=useState(()=>{try{return localStorage.getItem('pump-vault-pending:'+v.contractId+':'+account)??'';}catch{return '';}});
 const lock=useRef(false),apiRef=useRef(api),latestBlock=useRef(-1),readInFlight=useRef<Promise<void>|null>(null),mounted=useRef(false);apiRef.current=api;
 const s=o?.state,archived=!!v.archived||!!s?.archived;
 const mode=archived||privateAgent||!v.liveNav?'withdraw':selectedMode;
 const round=s?.round,operator=account===v.reporterId,controller=account===v.controllerId,closed=!!s?.pending||!!round;
 function setPendingHash(hash:string){updatePendingHash(hash);try{const key='pump-vault-pending:'+v.contractId+':'+account;if(hash)localStorage.setItem(key,hash);else localStorage.removeItem(key);}catch{}}
 function acceptObservation(next: typeof o) {
  if(!mounted.current || !next || next.blockHeight < latestBlock.current)return;
  latestBlock.current=next.blockHeight;
  setObservation(next);
  setObservationError('');
 }
 function observe() {
  if(readInFlight.current)return readInFlight.current;
  const request=apiRef.current('/vault-state',{agentId:v.agentId,runId:v.runId,account})
   .then(d=>acceptObservation(d.observation))
   .catch(e=>{if(mounted.current)setObservationError(e instanceof Error?e.message:'Balance lookup failed.');})
   .finally(()=>{readInFlight.current=null;});
  readInFlight.current=request;
  return request;
 }
 useEffect(()=>{
  mounted.current=true;
  const read=()=>{if(!document.hidden&&!lock.current)void observe();};
  void observe();
  const timer=window.setInterval(read,5000);
  window.addEventListener('focus',read);
  document.addEventListener('visibilitychange',read);
  return()=>{
   mounted.current=false;
   window.clearInterval(timer);
   window.removeEventListener('focus',read);
   document.removeEventListener('visibilitychange',read);
  };
 },[v.agentId,v.runId,v.contractId,account]);
 async function task(name:string,fn:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(name);setError('');setNotice('');try{await fn();}catch(e){setError((e as Error).message);}finally{lock.current=false;setBusy('');setProgress('');}}
 async function confirm(hash:string):Promise<InvestorReceipt>{
  let d:InvestorReceipt|undefined;
  for(let i=0;i<5;i++){
   try{d=await api('/vault-receipt',{agentId:v.agentId,runId:v.runId,account,hash});}catch(e){if(i===4)throw new Error(`Transaction submitted, but its outcome could not be checked. Use Check transaction before retrying. ${(e as Error).message}`);}
   if(d&&d.status!=='pending')break;
   setProgress('Waiting for testnet confirmation…');await new Promise(resolve=>setTimeout(resolve,1500));
  }
  if(!d||d.status==='pending')throw new Error('Your transaction is still confirming. Use Check transaction before sending another.');
  acceptObservation(d.observation);
  if(d.effect.outcome==='refunded'){setPendingHash('');throw new Error('Investment was not accepted. The test USDC was refunded and no pump coin were minted. Please try again with a fresh vault price.');}
  if(d.effect.outcome==='restored'){setPendingHash('');throw new Error('The withdrawal was not paid. Your pump coin and vault balance were restored.');}
  if(d.status==='failed'){setPendingHash('');throw new Error('The transaction failed. No investment or withdrawal success was confirmed. Check the transaction in your wallet.');}
  if(d.effect.outcome!=='confirmed')throw new Error('The transaction finalized, but the requested transfer or pump coin could not be verified. Check this transaction before sending another.');
  setPendingHash('');setLastHash(hash);return d;
 }
 async function sendPlan(plan:WalletPlan){
  if(!v.contractId)throw new Error('This vault is not deployed.');
  const result=await sendVaultPlan(plan,account,{...v,contractId:v.contractId} as VaultTarget),hash=result?.transaction?.hash;
  if(!hash)throw new Error('Your wallet returned no transaction hash. Check wallet history before retrying.');
  setPendingHash(hash);setProgress('Confirming on NEAR testnet…');return hash;
 }
 function message(r:InvestorReceipt){
  const e=r.effect;
  if(e.kind==='deposit')return `Investment successful. ${human(e.assets)} test USDC moved to ${v.name}’s vault. You received ${human(e.shares)} pump coin.`;
  if(e.kind==='withdraw')return `Withdrawal successful. ${human(e.assets)} test USDC paid to your wallet. ${human(e.shares)} pump coin was redeemed.`;
  if(e.kind==='setup')return 'Account setup complete. No investment has been made yet. Enter an amount and select Invest to continue.';
  if(e.kind==='reserve')return 'Vault surplus transaction confirmed.';
  return 'Testnet action confirmed.';
 }
 async function transact(){await task(mode,async()=>{
  const r=await runInvestorFlow({action:mode,amount:parse(amount),agentId:v.agentId,runId:v.runId,account,api,send:sendPlan,confirm,progress:setProgress});
  acceptObservation(r.observation);setNotice(message(r));setAmount('');await refresh().catch(()=>{});
 });}
 async function checkReceipt(hash:string){
  await task('receipt',async()=>{
   const transactionHash=hash.trim();
   if(!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(transactionHash))throw new Error('Enter a valid NEAR testnet transaction hash.');
   const receipt=await confirm(transactionHash);
   setNotice(pendingHash?message(receipt):'Past transaction verified. '+message(receipt));
   setReceiptQuery('');
   await refresh().catch(()=>{});
  });
 }
 async function prepare(action:string){const d=await api('/vault-plan',{agentId:v.agentId,runId:v.runId,action,account,amount:['reserve','withdraw-reserve'].includes(action)?parse(operatorAmount):''});setPlans(d.plans);if(!d.plans.length)setNotice('Account setup is already complete.');}
 async function sendReviewed(){let last:InvestorReceipt|undefined;for(let i=0;i<plans.length;i++){last=await confirm(await sendPlan(plans[i]));setPlans(plans.slice(i+1));}setPlans([]);if(last)setNotice(message(last));await observe();await refresh().catch(()=>{});}
 const button=(action:string,label:string,disabled=false)=><button type="button" className="nd-button secondary" disabled={!!busy||!!pendingHash||!account||!s||disabled} onClick={()=>void task(action,()=>prepare(action))}>{label}</button>;
 const available=mode==='invest'?o?.walletBalance:o?.redeemable;
 const balanceReady=available!=null&&!observationError;
 const staleWithoutRefresh=o?.navFresh===false&&(archived||!v.liveNav);
 const pricingDelayed=o?.navFresh===false;
 const unavailable=closed||staleWithoutRefresh||(mode==='invest'&&(archived||privateAgent||s?.paused||s?.public===false));
 const empty=balanceReady&&available==='0';
 return <><section className="nd-card av-vault av-invest-cta" id={fundingId} aria-label={`${mode==='invest'?'Invest in':'Withdraw from'} ${v.name}`}><div className="av-card-heading"><div className="nd-eyebrow">STRATEGY v{v.version} · NEAR TESTNET</div><h2><ShieldCheck size={22}/><span>{mode==='invest'?'Invest in':'Withdraw from'} {v.name} v{v.version}.</span></h2><p className="av-address">{archived?'Withdraw test USDC from this archived strategy’s vault.':privateAgent?'Investor deposits are closed while this agent is private.':mode==='withdraw'?'Redeem pump coin for test USDC from this strategy’s vault.':'Receive pump coin for this strategy when you invest test USDC.'}</p><button className="nd-icon av-refresh" aria-label="Refresh balances" title="Refresh balances" disabled={!!busy} onClick={()=>void task('refresh',observe)}><RefreshCw size={15}/></button></div>
 {(error||observationError)&&<p role="alert" className="nd-alert">{error||observationError}</p>}{notice&&<div role="status" className="nd-notice"><Check size={16}/><span>{notice}</span>{lastHash&&<details><summary>Transaction receipt</summary><p className="av-address">{lastHash}</p></details>}</div>}
 <div className="av-status"><span className="nd-pill">{observationError?'Vault state unavailable':s?.pending?'Withdrawal confirming':round?'Trading round active':!v.liveNav?'Withdrawals open':archived?'Archived · withdrawals only':privateAgent?'Private vault':s?.paused?'Investments paused':s?.live_nav?(pricingDelayed?'Price update delayed':s.live_nav.tracking?'Live pricing · investor access open':'Pricing synced · agent stopped'):s?'Investing & withdrawals open':'Loading vault balances…'}</span></div>
 {s?.live_nav&&<div className="av-live-price">
   <small>{o?.navFresh===false?'Last confirmed pump coin price':'pump coin price · test USDC'}</small>
   <h3>{human(o?.pumpCoinPrice)}</h3>
   <p>{pricingDelayed?'Showing the last confirmed price while Pump waits for a new valuation.':s.live_nav.tracking?'Updates automatically from fresh strategy valuations.':'The strategy is stopped with no open position.'}</p>
   <small>Confirmed valuation {new Date(s.live_nav.observed_at_ms).toLocaleTimeString()}</small>
   <button type="button" className="nd-text-button" disabled={!!busy} onClick={()=>void task('evidence',async()=>{const d=await api('/nav-evidence',{runId:v.runId});const url=URL.createObjectURL(new Blob([JSON.stringify(d.evidence,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${v.name}-v${v.version}-price-evidence.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);})}>Export price evidence</button>
   {o?.reportingError&&<details><summary>Latest price update issue</summary><p className="av-address">{o.reportingError}</p></details>}
   {o?.navFresh===false&&<p role="status">{staleWithoutRefresh?'Investments and withdrawals require a fresh confirmed price.':'Pump checks for a fresh price when you invest or withdraw.'}</p>}
 </div>}
 <div className="av-invest"><div><div className="av-flow-tabs" role="group" aria-label="Investment action">{(['invest','withdraw'] as const).filter(value=>value==='withdraw'||!archived&&!privateAgent&&!!v.liveNav).map(value=><button type="button" key={value} className={'nd-button '+(mode===value?'':'secondary')} aria-pressed={mode===value} disabled={!!busy||!!pendingHash} onClick={()=>{setMode(value);setAmount('');setError('');setNotice('');}}>{value==='invest'?'Invest':'Withdraw'}</button>)}</div>
 {mode==='withdraw'&&<><p>Enter the test USDC you want back. The vault redeems the required pump coin.</p></>}
 <label htmlFor={'invest-amount-'+v.agentId}>{mode==='invest'?'Amount to invest · test USDC':'Amount to withdraw · test USDC'}<div className="av-amount-field"><input id={'invest-amount-'+v.agentId} value={amount} aria-label={mode==='invest'?'Amount to invest · test USDC':'Amount to withdraw · test USDC'} placeholder="0.00" inputMode="decimal" autoComplete="off" maxLength={24} disabled={!!busy||!!pendingHash} onChange={e=>setAmount(e.target.value)}/><button type="button" className="nd-text-button" disabled={!!busy||!!pendingHash||!account||!balanceReady||empty} onClick={()=>setAmount(human(available))}>Max</button></div></label>
 <div className="av-balance">
  <p className="av-available" aria-live="polite">{!account
   ? 'Connect a NEAR testnet wallet to check your balance.'
   : observationError
    ? 'Current balance unavailable.'
    : !balanceReady
     ? 'Checking finalized balance…'
     : `${mode==='invest'?'Wallet balance':'Available to withdraw'}: ${human(available)} test USDC`}</p>
  {account&&<p className="av-balance-source"><a href={`https://testnet.nearblocks.io/address/${account}`} target="_blank" rel="noreferrer">{account}</a>
   {o&&<> · Finalized block {o.blockHeight} · {new Date(o.observedAt).toLocaleTimeString()}</>}</p>}
 </div>
 {unavailable&&<p role="status">{o?.navFresh===false?'Wait for a confirmed live valuation before investing or withdrawing.':round?'Investments and withdrawals reopen after this agent’s trading round settles.':s?.pending?'A withdrawal is confirming. Please wait.':'This agent is not accepting new investments right now.'}</p>}
 {account?<button type="button" className="nd-button av-invest-submit" disabled={!!busy||!!pendingHash||!balanceReady||!amount.trim()||unavailable||empty} onClick={()=>void transact()}>{busy?(progress||'Processing…'):mode==='invest'?'Invest':'Withdraw'}</button>:<button type="button" className="nd-button av-invest-submit" disabled={wallet.busy||!wallet.ready} onClick={()=>void wallet.connect()}>Connect wallet to {mode==='invest'?'invest':'withdraw'}</button>}
 {progress&&<p role="status">{progress}</p>}{mode==='invest'&&<><p className="av-help">Approve the transaction in your wallet. Your first investment may also require one-time account setup approvals. Those use test NEAR; only the investment transfers test USDC.</p>{account&&empty&&<p>This account held 0 Circle test USDC at the block above.</p>}<a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Get test USDC <ArrowRight size={13}/></a></>}
 {round&&Date.parse(o?.observedAt??'')>=round.started_at_ms+86400000&&<button type="button" className="nd-text-button" disabled={!!busy||!!pendingHash||!account} onClick={()=>void task('cancel',async()=>{const d=await api('/vault-plan',{agentId:v.agentId,runId:v.runId,account,action:'cancel-expired',amount:''});await confirm(await sendPlan(d.plans[0]));await observe();setNotice('Expired trading round closed. Investor access has reopened.');})}>Unlock expired round</button>}
 </div></div>
 <details className="av-ownership-details av-how-it-works"><summary>How your investment works</summary><p>Your test USDC goes into this strategy’s isolated vault. Its pump coin represents your ownership in this strategy’s vault. Withdraw to your wallet when the vault is open.</p><p>Deposits, pump coin and withdrawals are real NEAR testnet transactions. The agent trades a separate simulated portfolio.</p>{s?.live_nav?<p>A trusted local reporter publishes fresh whole-position valuations automatically while the strategy trades. Confirmed reports change the vault’s redeemable assets and pump coin price. Gains use this vault’s funded surplus and losses replenish it. Stale valuations pause investor transfers until reporting recovers.</p>:<p>Investments and withdrawals pause during an authorized trading round. A trusted reporter settles its simulated return: gains use this vault’s separate surplus; losses replenish it. An unsettled round can be cancelled after 24 hours without applying a simulated return.</p>}</details>
 <details className="av-ownership-details"><summary>Your investment & vault details</summary>{observationError&&o&&<p>Last verified values. Refresh to check current balances.</p>}<div className="av-metrics">{[['Invested assets · test USDC',s?.assets],['Vault surplus · test USDC',s?.reserve],['pump coin issued',s?.total_supply],['Your pump coin',o?.shares],['Available to withdraw · test USDC',o?.redeemable],['Your wallet · test USDC',o?.walletBalance]].map(([label,value])=><div key={label}><small>{label}</small><strong>{human(value)}</strong></div>)}</div><p className="av-address">{o&&<>Finalized block {o.blockHeight} · checked {new Date(o.observedAt).toLocaleTimeString()}<br/></>}Vault contract: {v.contractId}<br/>Circle USDC contract: <a href={`https://testnet.nearblocks.io/address/${v.tokenId}`} target="_blank" rel="noreferrer">{v.tokenId}</a><br/>Block hash: {o?.blockHash??'—'}<br/>Test-USDC balance held by contract: {human(o?.custodyBalance)}</p></details>
 {pendingHash&&<div className="nd-notice"><p>Your transaction is awaiting verification. Check it before submitting another investment.</p><p className="av-address">{pendingHash}</p><button className="nd-button secondary" disabled={!!busy} onClick={()=>void checkReceipt(pendingHash)}>Check transaction</button></div>}
 {account&&!pendingHash&&<details className="av-ownership-details av-receipt-lookup">
  <summary>Check a past transaction</summary>
  <p>Use a transaction hash from your wallet to check an investment or withdrawal for this vault.</p>
  <form onSubmit={e=>{e.preventDefault();void checkReceipt(receiptQuery);}}>
   <label>NEAR testnet transaction hash<input value={receiptQuery} onChange={e=>setReceiptQuery(e.target.value)} autoComplete="off" spellCheck={false} maxLength={64} disabled={!!busy}/></label>
   <button type="submit" className="nd-button secondary" disabled={!!busy||!receiptQuery.trim()}>Check transaction</button>
  </form>
 </details>}
 {plans.length>0&&<div className="nd-plan-review"><h3>Operator transaction</h3><p>{plans.map(p=>p.description).join('. ')}</p><details><summary>Transaction details</summary><pre>{JSON.stringify(plans,null,2)}</pre></details><button className="nd-button" disabled={!!busy||!!pendingHash} onClick={()=>void task('wallet',sendReviewed)}>Continue in wallet</button><button className="nd-text-button" disabled={!!busy} onClick={()=>setPlans([])}>Cancel</button></div>}
 </section>{manage&&(operator||controller)&&<section className="nd-card av-operator"><div className="nd-eyebrow">OPERATOR · TRUSTED TESTNET REPORTING</div><h2>Manage {v.name} v{v.version}’s {s?.live_nav?'live pricing':'demo round'}.</h2><label>Surplus amount · test USDC<input value={operatorAmount} onChange={e=>setOperatorAmount(e.target.value)} inputMode="decimal"/></label><div className="nd-buttons">{button('prepare','Set up vault accounts')}{controller&&button('reserve','Fund surplus')}{controller&&button('withdraw-reserve','Withdraw surplus',closed)}</div>{operator&&!s?.live_nav&&<><p>Bound to v{run.version} · {run.label}. Begin from a stopped strategy with no open position.</p><div className="nd-buttons">{button('begin','Begin round',archived||privateAgent||closed||run.session.state==='running'||run.session.portfolio.position!=='0'||s?.paused)}<button className="nd-button secondary" disabled={!!busy||archived||!round||!!pendingHash} onClick={()=>void task('start',async()=>{await api('/vault-start',{agentId:v.agentId,runId:v.runId});await refresh();setNotice('Bound paper strategy started.');})}>Start bound paper agent</button><button className="nd-button secondary" disabled={!!busy||!round} onClick={()=>void task('stop',async()=>{await api('/vault-stop',{agentId:v.agentId,runId:v.runId});await refresh();setNotice('Future decisions stopped; an in-flight decision may finish.');})}>Stop bound agent</button>{button('settle','Settle closed round',!round)}</div>{round&&<p className="av-address">Bound strategy: {round.run_id}<br/>Commitment: {round.strategy_hash}</p>}</>}</section>}</>;
}
