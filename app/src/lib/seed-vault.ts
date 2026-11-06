import { base58 } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2';
import { TEST_USDC, testAccount, units, type WalletPlan } from '../../../near-demo/types.js';
import { RpcQueryError, TestnetReads } from '../../../near-demo/rpc-reads.js';
import { nearConnector } from './near-demo-wallet.js';
import type { SeedVault } from '../../../near-demo/workspace-transfer.js';
export type { SeedVault } from '../../../near-demo/workspace-transfer.js';

export type SeedFactory = { id:string; codeHash:string; vaultCodeHash:string; funding:string };
type SeedState = { assets:string; nonce:number; pending:unknown; archived:boolean; paused:boolean; shares:string; received:string };
const bytes = new TextEncoder();
const hex = (value:Uint8Array) => Array.from(value, byte=>byte.toString(16).padStart(2,'0')).join('');
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const hash = /^[a-f0-9]{64}$/;
const maxSeed = 1_000_000_000_000n;

export function seedVaultAccount(owner:string, strategyId:string, factoryId:string) {
  testAccount(owner);
  if (!uuid.test(strategyId) || !/^ps\.[a-z0-9._-]+\.testnet$/.test(testAccount(factoryId))) throw new Error('Invalid seed vault binding.');
  return testAccount('s'+hex(sha256(bytes.encode(owner+':'+strategyId))).slice(0,24)+'.'+factoryId);
}

export function validateSeedVault(v:SeedVault, factory?:SeedFactory) {
  if (v.contractId!==seedVaultAccount(v.owner,v.strategyId,v.factoryId) || !uuid.test(v.agentId) ||
    !hash.test(v.manifestHash) || !hash.test(v.strategyHash) || units(v.amount,false)>maxSeed ||
    factory && (v.factoryId!==factory.id || units(factory.funding,false)>5n*10n**24n))
    throw new Error('Invalid seed vault binding.');
  return v;
}

// TestnetReads calls its fetcher as a method; browser fetch needs its Window receiver.
const reads = new TestnetReads((input, init) => fetch(input, init), undefined, Date.now, 0);
const query = (request_type:string, account_id:string, args:Record<string, unknown>={}) =>
  reads.query('query',{request_type,account_id,finality:'final',...args},true);
const view = async (account:string, method:string, args:Record<string,unknown>={}, block?:string) => {
  const params={request_type:'call_function',account_id:account,method_name:method,args_base64:btoa(String.fromCharCode(...bytes.encode(JSON.stringify(args))))};
  const response=await reads.query('query',{...params,...(block?{block_id:block}:{finality:'final'})},true);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(response.result)));
};
const missing = (error:unknown) => error instanceof RpcQueryError && error.data?.cause?.name==='UNKNOWN_ACCOUNT';

export async function readSeedVault(v:SeedVault, factory:SeedFactory):Promise<SeedState|null> {
  validateSeedVault(v,factory);
  let account;
  try { account=await query('view_account',v.contractId); } catch (error) { if (missing(error)) return null; throw error; }
  if (account.code_hash!==factory.vaultCodeHash || typeof account.block_hash!=='string') throw new Error('The vault code did not match Pump’s verified deployment.');
  const block=account.block_hash;
  const [keys,s,seed,shares]=await Promise.all([reads.query('query',{request_type:'view_access_key_list',account_id:v.contractId,block_id:block},true),
    view(v.contractId,'get_state',{},block),view(v.contractId,'seed_funding',{},block),view(v.contractId,'ft_balance_of',{account_id:v.owner},block)]);
  if (keys.keys?.length!==0 ||
      s.controller_id!==v.owner || s.factory_id!==factory.id || s.reporter_id!==factory.id || s.token_id!==TEST_USDC ||
      s.agent_id!==v.agentId || s.manifest_hash!==v.manifestHash || s.strategy_id!==v.strategyId || s.strategy_hash!==v.strategyHash ||
      s.public!==false || s.live_nav!==null || seed?.required!==v.amount || !['0',v.amount].includes(seed.received) ||
      !Number.isSafeInteger(s.nonce) || s.nonce<0 || units(s.assets)>units(seed.received) || units(shares)>units(s.assets))
    throw new Error('The testnet vault did not match this agent. No funds were sent.');
  return { assets:s.assets, nonce:s.nonce, pending:s.pending, archived:s.archived, paused:s.paused, shares, received:seed.received };
}

const plan = (v:SeedVault, receiverId:string, methodName:string, args:Record<string,unknown>, gas:string, deposit:string):WalletPlan =>
  ({network:'testnet',signerId:v.owner,receiverId,description:methodName,actions:[{type:'FunctionCall',params:{methodName,args,gas,deposit}}]});

export type SeedStep =
  | { kind:'deploy'|'storage'|'fund'; plan:WalletPlan }
  | { kind:'confirmed'; state:SeedState };

export async function seedStep(v:SeedVault, factory:SeedFactory):Promise<SeedStep> {
  const state=await readSeedVault(v,factory);
  if (state?.received===v.amount) return {kind:'confirmed',state};
  const balance=await view(TEST_USDC,'ft_balance_of',{account_id:v.owner});
  if (units(balance)<units(v.amount,false)) throw new Error('Your wallet does not have enough Circle test USDC to fund this agent.');
  if (!state) {
    const [account,keys,funding,child]=await Promise.all([query('view_account',factory.id),query('view_access_key_list',factory.id),
      view(factory.id,'funding'),view(factory.id,'vault_code_hash')]);
    if (account.code_hash!==factory.codeHash || keys.keys?.length!==0 || funding!==factory.funding ||
      base58.encode(Uint8Array.from(atob(child),c=>c.charCodeAt(0)))!==factory.vaultCodeHash)
      throw new Error('The NEAR testnet factory did not match Pump’s verified deployment.');
    return {kind:'deploy',plan:plan(v,factory.id,'deploy_seeded',{agent_id:v.agentId,manifest_hash:v.manifestHash,
      strategy_id:v.strategyId,strategy_hash:v.strategyHash,seed:v.amount},'220000000000000',factory.funding)};
  }
  if (state.paused||state.archived||state.pending) throw new Error('The agent vault is not accepting seed deposits.');
  if (!await view(TEST_USDC,'storage_balance_of',{account_id:v.contractId})) {
    const {min}=await view(TEST_USDC,'storage_balance_bounds');
    if (units(min,false)>10n**23n) throw new Error('Unexpected test USDC storage fee.');
    return {kind:'storage',plan:plan(v,TEST_USDC,'storage_deposit',{account_id:v.contractId,registration_only:true},'25000000000000',min)};
  }
  return {kind:'fund',plan:plan(v,TEST_USDC,'ft_transfer_call',{receiver_id:v.contractId,amount:v.amount,msg:'{"kind":"seed"}'},'100000000000000','1')};
}

async function send(v:SeedVault, transaction:WalletPlan) {
  const connector=await nearConnector(), wallet=await connector.wallet();
  if (connector.network!=='testnet' || !(await wallet.getAccounts({network:'testnet'})).some(a=>a.accountId===v.owner))
    throw new Error('Connect the owner’s NEAR testnet wallet.');
  return wallet.signAndSendTransaction({signerId:v.owner,receiverId:transaction.receiverId,actions:transaction.actions});
}

/** Recompute the next action after the user clicks; never submit a stale or supplied plan. */
export async function approveSeedStep(v:SeedVault, factory:SeedFactory, expected:Exclude<SeedStep['kind'],'confirmed'>) {
  const step=await seedStep(v,factory);
  if (step.kind!==expected) return step;
  await send(v,step.plan);
  if(expected==='fund'){
    const state=await waitFor(()=>readSeedVault(v,factory), next=>next?.received===v.amount);
    return {kind:'confirmed' as const,state:state!};
  }
  return waitFor(()=>seedStep(v,factory), next=>next.kind!==expected);
}

export async function withdrawSeed(v:SeedVault, factory:SeedFactory) {
  const state=await readSeedVault(v,factory);
  if (!state || state.pending || state.received!==v.amount || units(state.shares)===0n)
    throw new Error('No seed capital is available to withdraw.');
  await send(v,plan(v,v.contractId,'redeem',{shares:state.shares,min_assets:state.shares,expected_nonce:state.nonce},'100000000000000','1'));
  return waitFor(()=>readSeedVault(v,factory), next=>!!next&&!next.pending&&units(next.shares)<units(state.shares));
}

async function waitFor<T>(read:()=>Promise<T>, ready:(value:T)=>boolean) {
  for (let i=0;i<8;i++) {
    const next=await read();
    if (ready(next)) return next;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error('Testnet has not confirmed this action. Check wallet history and refresh before retrying.');
}
