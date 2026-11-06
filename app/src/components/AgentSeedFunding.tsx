import { useEffect, useState } from 'react';
import { ArrowRight, Wallet } from 'lucide-react';
import { NearWalletButton, useNearWallet } from './NearWalletProvider';
import { approveSeedStep, readSeedVault, seedStep, withdrawSeed, type SeedFactory, type SeedStep, type SeedVault } from '../lib/seed-vault';
import type { FundingDraft } from '../lib/browser-workspace';
import { paperAmountInput } from '../lib/paper-amount';

const labels={deploy:'Create vault',storage:'Register vault for USDC',fund:'Send seed USDC',confirmed:'Finish creating agent'};
const display=(value:string)=>paperAmountInput(value,6);
const near=(value:string)=>paperAmountInput(value,24);

export function AgentSeedFunding({draft,factory,onFinish,onBack}:{draft:FundingDraft;factory:SeedFactory;onFinish:()=>Promise<void>;onBack:()=>void}){
  const wallet=useNearWallet(),v=draft.vault;
  const [next,setNext]=useState<SeedStep>(),[error,setError]=useState(''),[busy,setBusy]=useState('');
  async function check(){
    setError('');setBusy('Checking testnet…');
    try{setNext(await seedStep(v,factory));}
    catch(e){setNext(undefined);setError((e as Error).message);}
    finally{setBusy('');}
  }
  async function advance(){
    if(!next||busy||wallet.account!==v.owner)return;
    setError('');setBusy(next.kind==='confirmed'?'Saving agent…':'Waiting for wallet and testnet…');
    try{
      if(next.kind==='confirmed')await onFinish();
      else {
        if(!navigator.locks)throw new Error('Use a browser that can coordinate wallet approvals across tabs.');
        setNext(await navigator.locks.request('pump-seed-'+v.contractId,{ifAvailable:true},lock=>{
          if(!lock)throw new Error('An approval for this vault is already open in another tab.');
          return approveSeedStep(v,factory,next.kind as Exclude<SeedStep['kind'],'confirmed'>);
        }));
      }
    }catch(e){setNext(undefined);setError((e as Error).message);}
    finally{setBusy('');}
  }
  useEffect(()=>{void check();},[]); // Each selected draft mounts its own funding view.
  return <section className="nd-card na-form">
    <div className="nd-eyebrow">STEP 3 OF 3 · NEAR TESTNET</div>
    <h2>Fund {draft.manifest.name}</h2>
    <p>Send <strong>{display(v.amount)} Circle test USDC</strong> from <strong>{v.owner}</strong> to this agent’s vault.</p>
    <p>Wallet approvals are required. Trades stay in paper mode.</p>
    <dl className="na-facts"><div><dt>Vault</dt><dd><code>{v.contractId}</code></dd></div>
      {next?.kind==='deploy'&&<div><dt>Vault setup</dt><dd>{near(next.plan.actions[0].params.deposit)} test NEAR for contract storage, plus gas</dd></div>}
      {next?.kind==='storage'&&<div><dt>USDC registration</dt><dd>{near(next.plan.actions[0].params.deposit)} test NEAR, plus gas</dd></div>}
      {next?.kind==='confirmed'&&<div><dt>Seed deposit</dt><dd>{display(v.amount)} test USDC confirmed on-chain</dd></div>}
    </dl>
    {wallet.account!==v.owner&&<div className="nw-registration"><strong>Connect the vault owner’s wallet</strong><NearWalletButton/></div>}
    {busy&&<p role="status" className="nd-notice">{busy}</p>}
    {error&&<p role="alert" className="nd-alert">{error}</p>}
    <div className="na-wizard-controls"><button type="button" className="nd-text-button" disabled={!!busy} onClick={onBack}>Save for later</button>
      <button type="button" className="nd-text-button" disabled={!!busy} onClick={()=>void check()}>Check vault</button>
      {next&&<button type="button" className="nd-button" disabled={!!busy||wallet.account!==v.owner} onClick={()=>void advance()}>{labels[next.kind]}<ArrowRight size={15}/></button>}
    </div>
  </section>;
}

export function AgentSeedBalance({vault,factory}:{vault:SeedVault;factory:SeedFactory}){
  const wallet=useNearWallet();
  const [state,setState]=useState<Awaited<ReturnType<typeof readSeedVault>>>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState(false);
  async function update(withdraw=false){
    setError('');setBusy(true);
    try{
      setState(withdraw?await withdrawSeed(vault,factory):await readSeedVault(vault,factory));
      setReview(false);
    }catch(e){setError((e as Error).message);setReview(false);}
    finally{setBusy(false);}
  }
  useEffect(()=>{void update();},[]);
  return <section className="ac-control-bar" aria-label="Agent seed vault">
    <div className="ac-control-state"><span className="ac-state-icon"><Wallet size={18}/></span><div>
      <span className="ac-overline">SEED VAULT · NEAR TESTNET</span>
      <h3>{state?`${display(state.assets)} test USDC`:'Vault balance'}</h3>
      <p><a href={`https://testnet.nearblocks.io/address/${vault.contractId}`} target="_blank" rel="noreferrer">View vault on-chain</a> · Separate from paper performance</p>
      {!!state?.pending&&<p role="status">Withdrawal pending.</p>}
      {review&&state&&<p>Return {display(state.shares)} test USDC to {vault.owner}?</p>}
      {error&&<p role="alert" className="nd-alert">{error}</p>}
    </div></div>
    <div className="ac-run-buttons">
      <button type="button" className="nd-button secondary" onClick={()=>void update()} disabled={busy}>Refresh vault</button>
      {state&&state.shares!=='0'&&!state.pending&&wallet.account===vault.owner&&<button type="button" className="nd-button secondary" disabled={busy} onClick={()=>review?void update(true):setReview(true)}>{review?'Approve withdrawal':'Withdraw seed'}</button>}
    </div>
  </section>;
}
