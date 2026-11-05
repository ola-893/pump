import {useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useNearWallet,NearWalletButton} from './NearWalletProvider';
import {sendDeploymentPlan} from '../lib/vault-deployment-wallet';
import type {WalletPlan} from '../../../near-demo/types';
export function StrategyVaultUpgrade({agentId,runId,owner,api,refresh}:{agentId:string;runId:string;owner:string;api:(path:string,body:unknown)=>Promise<any>;refresh:()=>Promise<void>}){
 const wallet=useNearWallet(),lock=useRef(false);
 const [step,setStep]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const read=()=>api('/vault-upgrade',{runId,account:owner});
 async function task(approve=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   let next=await read();
   if(approve&&step?.plan&&next.phase===step.phase&&JSON.stringify(next.plan)===JSON.stringify(step.plan)){
    if(wallet.account!==owner)throw new Error('Connect the registered owner wallet to approve this vault update.');
    await sendDeploymentPlan(next.plan as WalletPlan,wallet.account,agentId);
    next=await read();
   }
   setStep(next);await refresh();
  }catch(e){setError(e instanceof Error?e.message:'Vault update unavailable.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <div className="ac-save" aria-label="Update existing strategy vault">
  <button className="nd-button secondary" type="button" disabled={busy} onClick={()=>void task(false)}>{busy?'Checking vault…':'Set up live pricing'}</button>
  {step?.plan&&<><span>{step.phase==='deploy'?`Owner pays ${(Number(step.plan.actions[0].params.deposit)/1e24).toFixed(5)} test NEAR plus gas. Your strategy and history stay the same.`:step.phase==='pause'?'Close the old vault to new deposits. Existing investments can still be withdrawn.':'Open the updated vault to investors.'}</span>{wallet.account===owner?<button className="nd-button" type="button" disabled={busy} onClick={()=>void task(true)}>Approve in wallet</button>:<NearWalletButton/>}</>}
  {step?.phase==='withdraw'&&<span>Withdraw the existing {(Number(step.assets)/1e6).toFixed(6)} test USDC before switching vaults. <Link className="nd-text-button" to={step.withdrawUrl}>Open withdrawal</Link> Then check this update again.</span>}
  {step?.phase==='reserve'&&<span>Withdraw the old vault’s remaining surplus before switching.</span>}
  {step?.phase==='active'&&<span>Live-pricing vault verified.</span>}
  {error&&<p className="nd-alert" role="alert">{error}</p>}
 </div>;
}
