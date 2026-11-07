import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, Wallet } from 'lucide-react';
import { NearWalletButton, useNearWallet } from './NearWalletProvider';
import { approveSeedStep, readSeedVault, recoverStrategySeed, seedStep, withdrawSeed, type SeedFactory, type SeedStep, type SeedVault } from '../lib/seed-vault';
import type { FundingDraft } from '../lib/browser-workspace';
import { paperAmountInput } from '../lib/paper-amount';
import { runSeedFunding } from '../lib/seed-funding-flow';

const approvalMessages={deploy:'Approve vault creation in your wallet…',storage:'Approve USDC registration in your wallet…','share-storage':'Approve pump coin registration in your wallet…',open:'Approve opening the strategy vault in your wallet…',fund:'Approve the seed deposit in your wallet…',confirmed:'Saving funded agent…'};
const display=(value:string)=>paperAmountInput(value,6);
const near=(value:string)=>paperAmountInput(value,24);
const nearDisplay=(value:bigint,roundUp=false)=>{
  const tick=10n**19n;
  return paperAmountInput(((value+(roundUp?tick-1n:0n))/tick*tick).toString(),24);
};

export function AgentSeedFunding({draft,factory,onFinish,onBack,onArchive,revision=false}:{draft:FundingDraft;factory:SeedFactory;onFinish:()=>Promise<void>;onBack:()=>void;onArchive?:()=>Promise<void>;revision?:boolean}){
  const wallet=useNearWallet(),v=draft.vault;
  const [next,setNext]=useState<SeedStep>(),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const mounted=useRef(false),inFlight=useRef(false),connectedOwner=useRef(wallet.account);
  useLayoutEffect(()=>{connectedOwner.current=wallet.account;},[wallet.account]);
  const [receiptHash,setReceiptHash]=useState('');
  const balance=next&&next.kind!=='confirmed'?next.balance:undefined;
  const needsNear=!!balance&&balance.shortfall>0n;
  async function check(){
    if(inFlight.current)return;
    inFlight.current=true;
    setError('');setBusy('Checking testnet…');
    try{const step=await seedStep(v,factory);if(mounted.current)setNext(step);}
    catch(e){if(mounted.current){setNext(undefined);setError((e as Error).message);}}
    finally{inFlight.current=false;if(mounted.current)setBusy('');}
  }
  async function advance(){
    if(!next||inFlight.current||needsNear||wallet.account!==v.owner)return;
    inFlight.current=true;
    setError('');setBusy('Checking vault and seed balance…');
    try{
      if(!navigator.locks)throw new Error('Use a browser that can coordinate wallet approvals across tabs.');
      await navigator.locks.request('pump-seed-'+v.contractId,{ifAvailable:true},async lock=>{
        if(!lock)throw new Error('An approval for this vault is already open in another tab.');
        const checkOwner=()=>{
          if(!mounted.current)throw new Error('Vault setup paused. Resume this draft to continue.');
          if(connectedOwner.current!==v.owner)throw new Error('Reconnect the vault owner’s wallet to continue setup.');
        };
        checkOwner();
        await runSeedFunding({
          read:()=>seedStep(v,factory),
          approve:kind=>{checkOwner();return approveSeedStep(v,factory,kind);},
          onStep:step=>{checkOwner();setNext(step);setBusy(approvalMessages[step.kind]);},
          finish:async()=>{checkOwner();await onFinish();},
        });
      });
    }catch(e){if(mounted.current)setError((e as Error).message);}
    finally{inFlight.current=false;if(mounted.current)setBusy('');}
  }
  async function archive(){
    setError('');setBusy('Archiving draft…');
    try{await onArchive?.();}
    catch(e){setError((e as Error).message);}
    finally{setBusy('');}
  }
  async function recover(){
    setBusy('Checking deposit receipt…');setError('');
    try {await recoverStrategySeed(v,receiptHash.trim());setReceiptHash('');setNext(await seedStep(v,factory));}
    catch(e){setError((e as Error).message);}
    finally{setBusy('');}
  }
  useEffect(()=>{
    mounted.current=true;
    void check();
    return()=>{mounted.current=false;};
  },[]); // Each selected draft mounts its own funding view.
  return <section className="nd-card na-form">
    <div className="nd-eyebrow">{revision?'STRATEGY VAULT':'STEP 3 OF 3'} · NEAR TESTNET</div>
    <h2>Fund {draft.manifest.name}{revision&&` · Strategy v${draft.strategy?.version}`}</h2>
    <p>Create this vault and fund it with <strong>{display(v.amount)} Circle test USDC</strong> from <strong>{v.owner}</strong>.</p>
    <p>Approve each wallet request to complete setup.</p>
    <dl className="na-facts"><div><dt>Vault</dt><dd><code>{v.contractId}</code></dd></div>
      {next?.kind==='deploy'&&<div><dt>Vault setup</dt><dd>{near(next.plan.actions[0].params.deposit)} test NEAR for contract storage, plus gas</dd></div>}
      {next?.kind==='storage'&&<div><dt>USDC registration</dt><dd>{near(next.plan.actions[0].params.deposit)} test NEAR, plus gas</dd></div>}
      {balance&&<div><dt>Estimated upfront cost</dt><dd>{nearDisplay(balance.required,true)} test NEAR, including gas</dd></div>}
      {next?.kind==='confirmed'&&<div><dt>Seed deposit</dt><dd>{display(v.amount)} test USDC confirmed on-chain</dd></div>}
    </dl>
    {wallet.account!==v.owner&&<div className="nw-registration"><strong>Connect the vault owner’s wallet</strong><NearWalletButton/></div>}
    {busy&&<p role="status" className="nd-notice">{busy}</p>}
    {error&&<p role="alert" className="nd-alert">{error}</p>}
    {factory.reporterId&&error&&<details><summary>Verify an owner deposit from wallet history</summary>
      <label>Transaction hash<input value={receiptHash} onChange={event=>setReceiptHash(event.target.value)}/></label>
      <button type="button" className="nd-button secondary" disabled={!!busy||!receiptHash.trim()} onClick={()=>void recover()}>Verify deposit</button>
    </details>}
    {needsNear&&<p role="alert" className="nd-alert">Your wallet has {nearDisplay(balance.available)} test NEAR available. Add at least {nearDisplay(balance.shortfall,true)} test NEAR to {v.owner}, then check the balance again.</p>}
    <div className="na-wizard-controls"><button type="button" className="nd-text-button" disabled={!!busy} onClick={onBack}>Save for later</button>
      {onArchive&&<button type="button" className="nd-text-button" disabled={!!busy} onClick={()=>void archive()}>Archive draft</button>}
      <button type="button" className="nd-text-button" disabled={!!busy} onClick={()=>void check()}>{needsNear?'Check balance':'Check vault'}</button>
      {next&&<button type="button" className="nd-button" disabled={!!busy||needsNear||wallet.account!==v.owner} onClick={()=>void advance()}>{next.kind==='confirmed'?(revision?'Activate strategy':'Finish creating agent'):next.kind==='deploy'?'Create & fund vault':'Continue vault setup'}<ArrowRight size={15}/></button>}
    </div>
  </section>;
}

export function AgentSeedBalance({vault,factory}:{vault:SeedVault;factory:SeedFactory}){
  const wallet=useNearWallet();
  const [state,setState]=useState<Awaited<ReturnType<typeof readSeedVault>>>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[review,setReview]=useState(false);
  const cancelButton=useRef<HTMLButtonElement>(null),withdrawButton=useRef<HTMLButtonElement>(null);
  const restoreFocus=useRef(false);
  const canWithdraw=state&&state.shares!=='0'&&!state.pending&&wallet.account===vault.owner;
  useLayoutEffect(()=>{
    if(review)cancelButton.current?.focus();
    else if(restoreFocus.current){
      restoreFocus.current=false;
      withdrawButton.current?.focus();
    }
  },[review]);
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
      {review&&state&&<p>Return {display((BigInt(state.shares)*BigInt(state.assets)/BigInt(state.supply)).toString())} test USDC to {vault.owner}?</p>}
      {error&&<p role="alert" className="nd-alert">{error}</p>}
    </div></div>
    <div className="ac-run-buttons">
      <button type="button" className="nd-button secondary" onClick={()=>void update()} disabled={busy}>Refresh vault</button>
      {review?<>
        <button ref={cancelButton} type="button" className="nd-button secondary" disabled={busy} onClick={()=>{restoreFocus.current=true;setReview(false);}}>Cancel withdrawal</button>
        {canWithdraw&&<button type="button" className="nd-button secondary" disabled={busy} onClick={()=>void update(true)}>Approve withdrawal</button>}
      </>:canWithdraw&&<button ref={withdrawButton} type="button" className="nd-button secondary" disabled={busy} onClick={()=>setReview(true)}>Withdraw seed</button>}
    </div>
  </section>;
}
