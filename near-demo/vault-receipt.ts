import {TEST_USDC,units} from './types.js';
import type {VaultEffect} from './types.js';
export type {VaultEffect} from './types.js';
function decoded(value:unknown){try{if(typeof value!=='string'||value.length>65536)return undefined;return JSON.parse(Buffer.from(value,'base64').toString());}catch{return undefined;}}
function entries(r:any,executor:string,standard:string,event:string){return (r.receipts_outcome??[]).filter((x:any)=>x.outcome?.executor_id===executor&&!x.outcome?.status?.Failure).flatMap((x:any)=>(x.outcome.logs??[]).flatMap((line:unknown)=>{if(typeof line!=='string'||!line.startsWith('EVENT_JSON:'))return [];try{const e=JSON.parse(line.slice(11));return e.standard===standard&&e.event===event&&Array.isArray(e.data)?e.data:[];}catch{return [];}}));}
/** A finalized transaction is not necessarily an investment: setup and refunds are distinct. */
export function vaultReceiptEffect(r:any,account:string,vault:string):VaultEffect{
 const tx=r.transaction;
 if(tx?.signer_id!==account||![TEST_USDC,vault].includes(tx?.receiver_id)||tx.actions?.length!==1)throw new Error('Transaction is outside this agent vault.');
 const call=tx.actions[0].FunctionCall,args=decoded(call?.args),method=call?.method_name;
 if(!call||!args||typeof args!=='object')throw new Error('Unsupported vault transaction.');
 const final=r.final_execution_status==='FINAL',failed=!!r.status?.Failure||[r.transaction_outcome,...(r.receipts_outcome??[])].some(x=>x?.outcome?.status?.Failure),value=decoded(r.status?.SuccessValue);
 const usable=final&&!failed;
 if(method==='storage_deposit'){
  if(![account,vault].includes(args.account_id)||args.registration_only!==true)throw new Error('Storage transaction belongs to another account.');
  return {kind:'setup',outcome:usable&&value&&typeof value.total==='string'&&units(value.total)>0n?'confirmed':'unverified',accountId:args.account_id,receiverId:tx.receiver_id,method};
 }
 if(method==='ft_transfer_call'&&tx.receiver_id===TEST_USDC){
  if(args.receiver_id!==vault)throw new Error('Token transfer belongs to another vault.');
  const amount=String(args.amount);units(amount,false);let msg:any;try{msg=JSON.parse(args.msg);}catch{throw new Error('Unrecognized vault transfer.');}
  if(!['deposit','reserve'].includes(msg.kind))throw new Error('Unrecognized vault transfer.');
  const kind=msg.kind as 'deposit'|'reserve',base={kind,assets:amount,method};
  const transfer=entries(r,TEST_USDC,'nep141','ft_transfer').some((e:any)=>e.old_owner_id===account&&e.new_owner_id===vault&&e.amount===amount);
  const refunded=entries(r,TEST_USDC,'nep141','ft_transfer').some((e:any)=>e.old_owner_id===vault&&e.new_owner_id===account&&e.amount===amount);
  if(final&&value==='0'&&transfer&&refunded)return {...base,outcome:'refunded'};
  if(!usable||value!==amount||!transfer)return {...base,outcome:'unverified'};
  if(kind==='reserve')return {...base,outcome:entries(r,vault,'pump_agent_vault','reserve_funded').some((e:any)=>e.amount===amount)?'confirmed':'unverified'};
  const deposits=entries(r,vault,'pump_agent_vault','deposit').filter((e:any)=>e.account_id===account&&e.assets===amount);
  if(deposits.length!==1)return {...base,outcome:'unverified'};
  const shares=deposits[0].shares;units(shares,false);const minimum=units(msg.min_shares,false);
  const minted=entries(r,vault,'nep141','ft_mint').some((e:any)=>e.owner_id===account&&e.amount===shares);
  return {...base,shares,outcome:minted&&BigInt(shares)>=minimum?'confirmed':'unverified'};
 }
 if(tx.receiver_id!==vault)throw new Error('Transaction is outside this agent vault.');
 if(method==='redeem'||method==='withdraw_reserve'){
  const reserve=method==='withdraw_reserve',shares=reserve?undefined:String(args.shares);if(shares)units(shares,false);
  const matches=(e:any)=>e.account_id===account&&e.reserve===reserve&&(reserve?e.assets===String(args.amount):e.shares===shares);
  if(final&&value===false&&entries(r,vault,'pump_agent_vault','payout_restored').some(matches)&&(reserve||entries(r,vault,'nep141','ft_mint').some((e:any)=>e.owner_id===account&&e.amount===shares)))return {kind:reserve?'reserve':'withdraw',outcome:'restored',shares,method};
  const paid=entries(r,vault,'pump_agent_vault','payout_complete').filter(matches);
  if(usable&&value===true&&paid.length===1){const assets=String(paid[0].assets);units(assets);const transferred=entries(r,TEST_USDC,'nep141','ft_transfer').some((e:any)=>e.old_owner_id===vault&&e.new_owner_id===account&&e.amount===assets);if(transferred&&(reserve||BigInt(assets)>=units(args.min_assets)))return {kind:reserve?'reserve':'withdraw',outcome:'confirmed',assets,shares,method};}
  return {kind:reserve?'reserve':'withdraw',outcome:'unverified',shares,method};
 }
 const event=({begin_round:'round_started',settle_round:'simulated_round_settled',cancel_expired_round:'expired_round_cancelled'} as Record<string,string>)[method];
 if(!event)throw new Error('Unsupported vault transaction.');
 return {kind:'operator',outcome:usable&&entries(r,vault,'pump_agent_vault',event).length===1?'confirmed':'unverified',method};
}
