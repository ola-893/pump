import { nearConnector } from './near-demo-wallet.js';
import { TEST_USDC,testAccount,units,type WalletPlan } from '../../../near-demo/types.js';
export type VaultTarget={runId:string;strategyHash:string;contractId:string;controllerId:string;reporterId:string;tokenId:string;network:string};
const exact=(x:Record<string,unknown>,keys:string[])=>Object.keys(x).sort().join()===keys.sort().join();
export function validateVaultPlan(p:WalletPlan,account:string,v:VaultTarget){
 testAccount(account);testAccount(v.contractId);
 if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(v.runId)||
    !/^[a-f0-9]{64}$/.test(v.strategyHash)||
    !v.contractId.startsWith('s'+v.runId.replaceAll('-','')+'.')&&!/^s[a-f0-9]{24}\.(?:pv|pl)\./.test(v.contractId)||
    !v.contractId.endsWith('.testnet')||v.network!=='testnet'||v.tokenId!==TEST_USDC||
    p.network!=='testnet'||p.signerId!==account||p.actions.length!==1||
    ![v.contractId,TEST_USDC].includes(p.receiverId))throw new Error('Transaction is outside this strategy vault.');
 const {methodName:m,args:a,deposit:d,gas}=p.actions[0].params;if(p.actions[0].type!=='FunctionCall'||!/^\d+$/.test(gas)||BigInt(gas)>200000000000000n)throw new Error('Invalid testnet gas.');
 if(m==='storage_deposit'){if(!exact(a,['account_id','registration_only'])||a.registration_only!==true||![account,v.contractId].includes(String(a.account_id))||!/^[0-9]+$/.test(d)||BigInt(d)>100000000000000000000000n)throw new Error('Invalid storage preparation.');return;}
 if(p.receiverId===TEST_USDC){if(m!=='ft_transfer_call'||d!=='1'||!exact(a,['receiver_id','amount','msg'])||a.receiver_id!==v.contractId||units(a.amount,false)>1000000000000n)throw new Error('Invalid test USDC transfer.');const msg=JSON.parse(String(a.msg));if(msg.kind==='reserve'){if(!exact(msg,['kind'])||account!==v.controllerId)throw new Error('Controller surplus only.');}else if(msg.kind==='deposit'){if(!exact(msg,['kind','min_shares','expected_nonce'])||units(msg.min_shares,false)>10n**24n||!Number.isSafeInteger(msg.expected_nonce)||msg.expected_nonce<0)throw new Error('Invalid pump coin mint minimum.');}else throw new Error('Unsupported deposit message.');return;}
 if(m==='redeem'){if(d!=='1'||!exact(a,['shares','min_assets','expected_nonce'])||units(a.shares,false)>10n**24n)throw new Error('Invalid redemption.');units(a.min_assets);}
 else if(m==='withdraw_reserve'){if(account!==v.controllerId||d!=='1'||!exact(a,['amount','expected_nonce']))throw new Error('Controller surplus only.');units(a.amount,false);}
 else if(m==='begin_round'){if(account!==v.reporterId||d!=='0'||!exact(a,['run_id','strategy_hash','reference_equity','start_sequence','expected_nonce'])||a.run_id!==v.runId||a.strategy_hash!==v.strategyHash||!Number.isSafeInteger(a.start_sequence)||Number(a.start_sequence)<0)throw new Error('Invalid round authorization.');units(a.reference_equity,false);}
 else if(m==='settle_round'){if(account!==v.reporterId||d!=='0'||!exact(a,['run_id','ending_equity','sequence','evidence_hash','expected_nonce'])||a.run_id!==v.runId||!/^[a-f0-9]{64}$/.test(String(a.evidence_hash))||!Number.isSafeInteger(a.sequence)||Number(a.sequence)<0)throw new Error('Invalid simulated settlement.');units(a.ending_equity);}
 else if(m==='cancel_expired_round'){if(d!=='0'||!exact(a,['expected_nonce']))throw new Error('Invalid expired-round cancellation.');}
 else throw new Error('Unsupported vault method.');
 if(!Number.isSafeInteger(a.expected_nonce)||Number(a.expected_nonce)<0)throw new Error('Invalid NAV version.');
}
export async function sendVaultPlan(plan:WalletPlan,account:string,target:VaultTarget){validateVaultPlan(plan,account,target);const c=await nearConnector(),wallet=await c.wallet(),accounts=await wallet.getAccounts({network:'testnet'});if(c.network!=='testnet'||!accounts.some(a=>a.accountId===account))throw new Error('Wallet account or network changed. Reconnect.');return wallet.signAndSendTransaction({signerId:account,receiverId:plan.receiverId,actions:plan.actions});}
