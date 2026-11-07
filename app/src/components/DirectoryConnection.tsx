import {useState,useRef} from 'react';
import {useNearWallet} from './NearWalletProvider';
import {nearConnector} from '../lib/near-demo-wallet';
import {withAccountWallet} from '../lib/near-wallet-account';
type Status={mode:string;url:string;enabledOwners:string[];error:string};
export function DirectoryConnection({status,api,refresh}:{status?:Status;api:(path:string,body:unknown)=>Promise<any>;refresh:()=>Promise<void>}){
 const {account}=useNearWallet(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),lock=useRef(false);
 if(!status)return null;
 const enabled=status.enabledOwners.includes(account);
 async function authorize(){if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');
  try{
   const c=await api('/directory-challenge',{account,action:enabled?'revoke':'grant'});
   if(c.account!==account)throw new Error('Wallet account changed.');
   const signed=await withAccountWallet(await nearConnector(),account,wallet=>wallet.signMessage({signerId:account,network:'testnet',message:c.message,recipient:c.recipient,nonce:Uint8Array.from(atob(c.nonce),x=>x.charCodeAt(0))}));
   await api('/directory-authorize',{id:c.id,signed});await refresh();setNotice(enabled?'Shared publishing disconnected. Existing public records remain inspectable.':'Wallet ownership verified. This computer can now publish your public agents.');
  }catch(e){setError(e instanceof Error?e.message:'Directory authorization failed.');}finally{lock.current=false;setBusy(false);}
 }
 return <section className="nd-card na-detail" aria-label="Shared directory connection"><details><summary className="na-account-summary">Shared directory · {enabled?'Connected':'Not connected'}</summary><p className="na-note">Authorize this computer to publish your public agents, strategies and trading evidence to {status.url}. Private agents and model files stay on this computer. This permission cannot move tokens or start trades.</p><button type="button" className="nd-button secondary" disabled={busy||!account} onClick={()=>void authorize()}>{busy?'Waiting for wallet…':enabled?'Disconnect shared publishing':'Verify wallet & publish public agents'}</button>{!account&&<p>Connect the owner’s wallet first.</p>}{(error||status.error)&&<p className="nd-alert" role="alert">{error||status.error}</p>}{notice&&<p className="nd-notice" role="status">{notice}</p>}</details></section>;
}
