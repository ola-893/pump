import type {WalletPlan} from '../../../near-demo/types.js';
import type {VaultEffect} from '../../../near-demo/types.js';
export type InvestorReceipt={hash:string;status:'pending'|'failed'|'final';effect:VaultEffect;observation:any};
export type InvestorFlow={action:'invest'|'withdraw';amount:string;agentId:string;runId:string;account:string;api:(path:string,body?:unknown)=>Promise<any>;send:(plan:WalletPlan)=>Promise<string>;confirm:(hash:string)=>Promise<InvestorReceipt>;progress:(message:string)=>void};
/** One investor action. Setup is completed first; the funding plan is created only afterward. */
export async function runInvestorFlow(f:InvestorFlow):Promise<InvestorReceipt>{
 if(!/^[1-9][0-9]*$/.test(f.amount))throw new Error('Enter a positive amount.');
 f.progress('Checking your available balance…');
 const body={agentId:f.agentId,account:f.account,amount:f.amount,runId:f.runId},o=(await f.api('/vault-state',{agentId:f.agentId,runId:f.runId,account:f.account})).observation;
 if(o.state.round||o.state.pending||(f.action==='invest'&&o.state.paused))throw new Error('This vault is temporarily closed. No tokens have been sent.');
 const available=f.action==='invest'?o.walletBalance:o.redeemable;
 if(available==null||BigInt(f.amount)>BigInt(available))throw new Error(f.action==='invest'?'Insufficient test USDC. Add faucet tokens to your connected wallet first.':'Amount exceeds your available withdrawal balance.');
 if(f.action==='invest'){
  f.progress('Checking one-time account setup…');
  const setup=(await f.api('/vault-plan',{...body,action:'prepare',amount:''})).plans as WalletPlan[];
  for(let i=0;i<setup.length;i++){
   f.progress(`Approve one-time account setup ${i+1} of ${setup.length} in your wallet.`);
   const plan=setup[i],hash=await f.send(plan),r=await f.confirm(hash);
   if(r.status!=='final'||r.effect.kind!=='setup'||r.effect.outcome!=='confirmed'||r.effect.receiverId!==plan.receiverId||r.effect.accountId!==plan.actions[0].params.args.account_id)throw new Error('Account setup was not confirmed. No investment was submitted.');
  }
 }
 // Re-read NAV and limits after setup; never reuse a pre-setup deposit nonce.
 f.progress('Checking the confirmed vault price…');
 const {plans,approvalExpiresAt}=await f.api('/vault-plan',{...body,action:f.action==='invest'?'deposit':'withdraw'}) as {plans:WalletPlan[];approvalExpiresAt?:number};
 if(plans.length!==1)throw new Error('Investment transaction could not be prepared.');
 if(approvalExpiresAt!==undefined&&approvalExpiresAt<=Date.now())throw new Error('The price window expired. Request a new quote.');
 const prompt=f.action==='invest'?'Confirm your investment in your wallet.':'Confirm your withdrawal in your wallet.';
 f.progress(approvalExpiresAt===undefined?prompt:`${prompt} The price is held until ${new Date(approvalExpiresAt).toLocaleTimeString()}.`);
 const r=await f.confirm(await f.send(plans[0]));
 if(r.status!=='final'||r.effect.outcome!=='confirmed')throw new Error('The requested operation is not confirmed. Check its receipt before retrying.');
 if(f.action==='invest'&&(r.effect.kind!=='deposit'||r.effect.assets!==f.amount||!r.effect.shares||BigInt(r.effect.shares)<=0n))throw new Error('The transfer and pump coin mint could not be verified.');
 if(f.action==='withdraw'&&(r.effect.kind!=='withdraw'||!r.effect.assets||BigInt(r.effect.assets)<BigInt(f.amount)||r.effect.shares!==plans[0].actions[0].params.args.shares))throw new Error('The withdrawal payout could not be verified.');
 return r;
}
