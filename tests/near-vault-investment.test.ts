import test from 'node:test';
import assert from 'node:assert/strict';
import {runInvestorFlow,type InvestorReceipt} from '../app/src/lib/vault-investment.js';
import {vaultReceiptEffect} from '../near-demo/vault-receipt.js';
import {seedVaultAccount,verifySeedReceipt} from '../app/src/lib/seed-vault.js';
import {TEST_USDC,type WalletPlan} from '../near-demo/types.js';
const account='alice.testnet',vault='v123456781234.parent.testnet',agentId='12345678-1234-1234-1234-123456789abc';
const encode=(x:unknown)=>Buffer.from(JSON.stringify(x)).toString('base64');
const log=(standard:string,event:string,data:object)=>'EVENT_JSON:'+JSON.stringify({standard,version:'1.0.0',event,data:[data]});
function outcome(executor_id:string,logs:string[]=[]){return {outcome:{executor_id,logs,status:{SuccessValue:''}}};}
function receipt(method:string,args:object,receiver=TEST_USDC,value:unknown='5000000'){
 return {transaction:{signer_id:account,receiver_id:receiver,actions:[{FunctionCall:{method_name:method,args:encode(args)}}]},final_execution_status:'FINAL',status:{SuccessValue:encode(value)},transaction_outcome:outcome(account),receipts_outcome:[] as any[]};
}
function deposit(){const r=receipt('ft_transfer_call',{receiver_id:vault,amount:'5000000',msg:JSON.stringify({kind:'deposit',min_shares:'4500000',expected_nonce:4})});r.receipts_outcome=[outcome(TEST_USDC,[log('nep141','ft_transfer',{old_owner_id:account,new_owner_id:vault,amount:'5000000'})]),outcome(vault,[log('nep141','ft_mint',{owner_id:account,amount:'4500000'}),log('pump_agent_vault','deposit',{account_id:account,assets:'5000000',shares:'4500000'})])];return r;}
test('deposit success requires actual token movement, vault acceptance and a matching share mint',()=>{
 const r=deposit();assert.deepEqual(vaultReceiptEffect(r,account,vault),{kind:'deposit',assets:'5000000',shares:'4500000',method:'ft_transfer_call',outcome:'confirmed'});
 for(const mutate of [(x:any)=>x.receipts_outcome[0].outcome.logs=[],(x:any)=>x.receipts_outcome[1].outcome.logs.pop(),(x:any)=>x.receipts_outcome[1].outcome.logs.shift(),(x:any)=>x.receipts_outcome[1].outcome.executor_id='spoof.testnet',(x:any)=>x.status.SuccessValue=encode('4000000'),(x:any)=>x.final_execution_status='EXECUTED']){const x=structuredClone(r);mutate(x);assert.equal(vaultReceiptEffect(x,account,vault).outcome,'unverified');}
});
test('registration accepts only a finalized owner seed receipt for the exact strategy vault and amount',async t=>{
 const factoryId='pl.parent.testnet',contractId=seedVaultAccount(account,agentId,factoryId),hash='a'.repeat(44);
 const binding={factoryId,contractId,owner:account,agentId,strategyId:agentId,manifestHash:'a'.repeat(64),
  strategyHash:'b'.repeat(64),amount:'5000000',strategyName:'Test agent'};
 const response=JSON.parse(JSON.stringify(deposit()).replaceAll(vault,contractId));
 response.transaction.hash=hash;
 response.transaction.actions[0].FunctionCall.args=encode({
  receiver_id:contractId,amount:'5000000',msg:JSON.stringify({kind:'deposit',min_shares:'4500000',expected_nonce:4}),
 });
 t.mock.method(globalThis,'fetch',async (_url:unknown,init:RequestInit)=>{
  const {method,params}=JSON.parse(String(init.body));
  assert.equal(method,'tx');
  assert.deepEqual(params,{tx_hash:hash,sender_account_id:account,wait_until:'FINAL'});
  return Response.json({result:response});
 });
 assert.equal(await verifySeedReceipt(binding,hash),true);
 await assert.rejects(verifySeedReceipt({...binding,amount:'4000000'},hash),/exact owner deposit/);
 response.final_execution_status='EXECUTED';
 await assert.rejects(verifySeedReceipt(binding,hash),/unconfirmed/);
 response.final_execution_status='FINAL';
 response.transaction.signer_id='bob.testnet';
 await assert.rejects(verifySeedReceipt(binding,hash),/outside this agent vault/);
});
test('a finalized refund and account setup never masquerade as an investment',()=>{
 const r=deposit();r.status.SuccessValue=encode('0');r.receipts_outcome[1]=outcome(TEST_USDC,[log('nep141','ft_transfer',{old_owner_id:vault,new_owner_id:account,amount:'5000000'})]);assert.equal(vaultReceiptEffect(r,account,vault).outcome,'refunded');
 const setup=receipt('storage_deposit',{account_id:account,registration_only:true},vault,{total:'1250000000000000000000',available:'0'});assert.deepEqual(vaultReceiptEffect(setup,account,vault),{kind:'setup',outcome:'confirmed',accountId:account,receiverId:vault,method:'storage_deposit'});
 assert.throws(()=>vaultReceiptEffect(r,'bob.testnet',vault),/outside/);assert.throws(()=>vaultReceiptEffect(r,account,'v000000000000.parent.testnet'),/another vault/);
});
test('a withdrawal is confirmed only when its callback and token payout agree; restoration is distinct',()=>{
 const r=receipt('redeem',{shares:'4000000',min_assets:'4400000',expected_nonce:5},vault,true);
 r.receipts_outcome=[outcome(TEST_USDC,[log('nep141','ft_transfer',{old_owner_id:vault,new_owner_id:account,amount:'4400000'})]),outcome(vault,[log('pump_agent_vault','payout_complete',{account_id:account,shares:'4000000',assets:'4400000',reserve:false})])];
 assert.equal(vaultReceiptEffect(r,account,vault).outcome,'confirmed');r.receipts_outcome[0].outcome.logs=[];assert.equal(vaultReceiptEffect(r,account,vault).outcome,'unverified');
 r.status.SuccessValue=encode(false);r.receipts_outcome=[{outcome:{executor_id:TEST_USDC,status:{Failure:{ActionError:{}}},logs:[]}},outcome(vault,[log('pump_agent_vault','payout_restored',{account_id:account,shares:'4000000',assets:'4400000',reserve:false}),log('nep141','ft_mint',{owner_id:account,amount:'4000000'})])];assert.equal(vaultReceiptEffect(r,account,vault).outcome,'restored');
});
function flowFixture(){
 const steps:string[]=[],state={state:{round:null,pending:null,paused:false},walletBalance:'100000000',redeemable:'10000000'},plans:WalletPlan[]=[account,vault,account].map((who,i)=>({network:'testnet',signerId:account,receiverId:i===2?vault:TEST_USDC,description:'Named setup fixture',actions:[{type:'FunctionCall',params:{methodName:'storage_deposit',args:{account_id:who,registration_only:true},deposit:'1',gas:'1'}}]}));
 const funding:WalletPlan={network:'testnet',signerId:account,receiverId:TEST_USDC,description:'Named deposit fixture',actions:[{type:'FunctionCall',params:{methodName:'ft_transfer_call',args:{amount:'5000000',receiver_id:vault,msg:'{}'},deposit:'1',gas:'1'}}]};
 let mode='confirmed',cancel=-2,nonce=1;
 const api=async(path:string,b:any)=>{steps.push(path+':'+(b.action??''));if(path==='/vault-state')return {observation:state};if(b.action==='prepare')return {plans};assert.equal(nonce,4,'funding plan must be requested after all setup confirmations');return {plans:[funding]};};
 const send=async(p:WalletPlan)=>{const i=plans.indexOf(p);steps.push('send:'+i);if(i===cancel)throw new Error('Wallet rejected');return i<0?'fund':'setup'+i;};
 const confirm=async(hash:string)=>{steps.push('confirm:'+hash);if(hash.startsWith('setup')){nonce++;const p=plans[Number(hash.slice(5))];return {hash,status:'final',effect:{kind:'setup',outcome:'confirmed',receiverId:p.receiverId,accountId:p.actions[0].params.args.account_id},observation:state} as InvestorReceipt;}return {hash,status:'final',effect:{kind:'deposit',outcome:mode,assets:'5000000',shares:'4500000'},observation:state} as InvestorReceipt;};
 return {steps,state,plans,funding,api,send,confirm,setMode:(s:string)=>mode=s,cancel:(i:number)=>cancel=i};
}
test('one Invest action completes every setup transaction before obtaining a fresh funding plan',async()=>{
 const f=flowFixture();const r=await runInvestorFlow({action:'invest',amount:'5000000',agentId,runId:agentId,account,...f,progress:()=>{}});assert.equal(r.effect.kind,'deposit');assert.deepEqual(f.steps,['/vault-state:','/vault-plan:prepare','send:0','confirm:setup0','send:1','confirm:setup1','send:2','confirm:setup2','/vault-plan:deposit','send:-1','confirm:fund']);
});
test('empty wallet and cancelled setup cannot send a deposit or show investment success',async()=>{
 const f=flowFixture();f.state.walletBalance='0';await assert.rejects(runInvestorFlow({action:'invest',amount:'5000000',agentId,runId:agentId,account,...f,progress:()=>{}}),/Insufficient/);assert.equal(f.steps.some(s=>s.startsWith('send')),false);
 const c=flowFixture();c.cancel(1);await assert.rejects(runInvestorFlow({action:'invest',amount:'5000000',agentId,runId:agentId,account,...c,progress:()=>{}}),/rejected/);assert.equal(c.steps.includes('/vault-plan:deposit'),false);assert.equal(c.steps.includes('send:2'),false);
});
test('refund or unverifiable finalization is not investment success',async()=>{
 for(const mode of ['refunded','unverified']){const f=flowFixture();f.setMode(mode);await assert.rejects(runInvestorFlow({action:'invest',amount:'5000000',agentId,runId:agentId,account,...f,progress:()=>{}}),/not confirmed/);}
});
test('Withdraw uses a USDC amount, skips setup, and verifies the actual payout and shares',async()=>{
 const calls:string[]=[];const plan:WalletPlan={network:'testnet',signerId:account,receiverId:vault,description:'Named withdrawal fixture',actions:[{type:'FunctionCall',params:{methodName:'redeem',args:{shares:'4545455',min_assets:'5000000',expected_nonce:5},deposit:'1',gas:'150000000000000'}}]};
 const api=async(path:string,b:any)=>{calls.push(path+':'+(b.action??''));return path==='/vault-state'?{observation:{state:{},redeemable:'10000000'}}:{plans:[plan]};};
 const r=await runInvestorFlow({action:'withdraw',amount:'5000000',agentId,runId:agentId,account,api,send:async()=> 'withdrawal',confirm:async()=>({hash:'withdrawal',status:'final',effect:{kind:'withdraw',outcome:'confirmed',assets:'5000000',shares:'4545455'},observation:{}}),progress:()=>{}});assert.equal(r.effect.kind,'withdraw');assert.deepEqual(calls,['/vault-state:','/vault-plan:withdraw']);
});
