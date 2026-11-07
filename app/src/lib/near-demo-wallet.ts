import { TEST_USDC, TESTNET_RPC, testAccount } from '../../../near-demo/types.js';
import type { TestnetConfig, WalletPlan } from '../../../near-demo/types.js';
import type { NearConnector } from '@hot-labs/near-connect';
import { rememberWalletAccount, withAccountWallet } from './near-wallet-account.js';
let connector:Promise<NearConnector>|undefined;
export async function nearConnector(){
  connector ??= import('@hot-labs/near-connect').then(({NearConnector})=>{
    const current=new NearConnector({network:'testnet',autoConnect:false,features:{testnet:true,signAndSendTransaction:true},providers:{testnet:[TESTNET_RPC,'https://near-testnet.drpc.org','https://testnet-rpc.intea.rs']}});
    current.on('wallet:signIn',event=>{
      if(event.success&&current.network==='testnet')rememberWalletAccount(event.wallet.manifest.id,event.accounts);
    });
    current.on('wallet:signOut',()=>rememberWalletAccount('meteor-wallet',[]));
    return current;
  }).catch(error=>{connector=undefined;throw error;});
  const current=await connector;
  if(current.network!=='testnet')throw new Error('Demo wallet must be on NEAR testnet.');return current;
}
export function validateDemoPlan(plan:WalletPlan,account:string,config:TestnetConfig){
  testAccount(account);
  if(plan.network!=='testnet'||plan.signerId!==account||config.network!=='testnet'||config.tokenId!==TEST_USDC||![TEST_USDC,config.contractId].includes(plan.receiverId)||plan.actions.length!==1)throw new Error('Transaction is outside the testnet demo.');
  const a=plan.actions[0];if(a.type!=='FunctionCall'||!/^\d+$/.test(a.params.gas)||BigInt(a.params.gas)>100_000_000_000_000n)throw new Error('Invalid testnet action.');
  const m=a.params.methodName,d=a.params.deposit;
  if(plan.receiverId===TEST_USDC){
    if(m==='ft_transfer_call'){
      const msg=JSON.parse(String(a.params.args.msg));
      if(d!=='1'||a.params.args.receiver_id!==config.contractId||!['deposit','reserve'].includes(msg.kind)||!/^\d+$/.test(String(a.params.args.amount)))throw new Error('Invalid Circle test USDC deposit.');
      if(msg.kind==='reserve'&&account!==config.controllerId)throw new Error('Controller only.');
    }else if(m==='storage_deposit'){
      if(![account,config.contractId].includes(String(a.params.args.account_id))||!/^[0-9]+$/.test(d)||BigInt(d)>100_000_000_000_000_000_000_000n)throw new Error('Invalid testnet storage registration.');
    }else throw new Error('Unsupported test USDC action.');
  }else{
    if(!['register','withdraw','withdraw_reserve','record_result'].includes(m))throw new Error('Unsupported clearing action.');
    if(m==='register'?d!=='20000000000000000000000':m==='record_result'?d!=='0':d!=='1')throw new Error('Invalid attached test NEAR.');
    if(m==='record_result'&&account!==config.reporterId)throw new Error('Reporter only.');
    if(m==='withdraw_reserve'&&account!==config.controllerId)throw new Error('Controller only.');
  }
}
export async function sendDemoPlan(plan:WalletPlan,account:string,config:TestnetConfig){
  validateDemoPlan(plan,account,config);
  return withAccountWallet(await nearConnector(),account,wallet=>wallet.signAndSendTransaction({signerId:account,receiverId:plan.receiverId,actions:plan.actions}));
}
