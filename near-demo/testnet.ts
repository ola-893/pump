import {testnetReads} from './rpc.js';
import { TEST_USDC, testAccount, units, type TestnetConfig, type WalletPlan } from './types.js';
export type { TestnetConfig, WalletPlan } from './types.js';
export { TESTNET_RPC } from './types.js';
export class TestnetDemo {
  readonly config:TestnetConfig;
  private fetcher:typeof fetch;
  constructor(config:TestnetConfig,fetcher=fetch){
    this.config=config;this.fetcher=fetcher;
    if(config.network!=='testnet'||config.tokenId!==TEST_USDC)throw new Error('Only Circle NEAR testnet USDC is allowed.');
    testAccount(config.controllerId);testAccount(config.reporterId);
    if(config.contractId&&!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(config.contractId))throw new Error('Clearing contract must be a named .testnet account.');
  }
  private async rpc(method:string,params:unknown){
    return testnetReads(this.fetcher).query(method,params);
  }
  async view(contract:string,method:string,args:Record<string,unknown>={},blockId?:string,fresh=false){const r=await testnetReads(this.fetcher).query('query',{request_type:'call_function',...(blockId?{block_id:blockId}:{finality:'final'}),account_id:contract,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')},fresh);return {value:JSON.parse(Buffer.from(r.result).toString()),blockHash:r.block_hash,blockHeight:r.block_height};}
  async inspect(account?:string){
    if(account)testAccount(account);
    const base={...this.config,configured:!!this.config.contractId,tokenSymbol:'test USDC',chain:'NEAR testnet',contractState:null as any,claim:null as any,walletBalance:null as string|null,error:null as string|null};
    if(!this.config.contractId)return base;
    const observed=await this.view(this.config.contractId,'get_state'),s=observed.value;
    if(s.version!=='PUMPCOIN-TESTNET-CLEARING-v1'||s.token_id!==TEST_USDC||s.controller_id!==this.config.controllerId||s.reporter_id!==this.config.reporterId)throw new Error('Clearing contract does not match the reviewed demo configuration.');
    base.contractState=s;
    if(account){base.claim=(await this.view(this.config.contractId,'get_claim',{account_id:account})).value;base.walletBalance=(await this.view(TEST_USDC,'ft_balance_of',{account_id:account})).value;}
    return {...base,observedAt:new Date().toISOString(),blockHash:observed.blockHash,blockHeight:observed.blockHeight};
  }
  private call(who:string,receiver:string,method:string,args:Record<string,unknown>,deposit='0',description=method):WalletPlan{
    testAccount(who);return {network:'testnet',signerId:who,receiverId:receiver,actions:[{type:'FunctionCall',params:{methodName:method,args,gas:'70000000000000',deposit}}],description};
  }
  async plan(action:string,who:string,amount?:string,sessionId?:string,result?:Record<string,unknown>):Promise<WalletPlan[]>{
    const state=await this.inspect(who),contract=this.config.contractId;if(!contract)throw new Error('Deploy and configure the testnet clearing contract first.');
    if(action==='prepare'){
      const plans:WalletPlan[]=[];const bounds=(await this.view(TEST_USDC,'storage_balance_bounds')).value;
      for(const account of [who,contract])if(!(await this.view(TEST_USDC,'storage_balance_of',{account_id:account})).value)plans.push(this.call(who,TEST_USDC,'storage_deposit',{account_id:account,registration_only:true},String(bounds.min),'Register test USDC storage'));
      if(!state.claim)plans.push(this.call(who,contract,'register',{},'20000000000000000000000','Register demo claim account · 0.02 test NEAR'));
      return plans;
    }
    if(action==='deposit'||action==='reserve'){
      units(amount,false);if(!state.claim&&action==='deposit')throw new Error('Prepare your account first.');
      if(action==='reserve'&&who!==this.config.controllerId)throw new Error('Only the configured controller funds the demo surplus.');
      if(action==='deposit'&&(!sessionId||!/^[a-f0-9-]{36}$/.test(sessionId)))throw new Error('Select a new paper session.');
      return [this.call(who,TEST_USDC,'ft_transfer_call',{receiver_id:contract,amount,msg:JSON.stringify(action==='reserve'?{kind:'reserve'}:{kind:'deposit',session_id:sessionId})},'1',action==='reserve'?'Fund separate testnet surplus; excluded from agent P&L':'Deposit Circle test USDC into demo claim')];
    }
    if(action==='withdraw'||action==='withdraw-reserve'){units(amount,false);return [this.call(who,contract,action==='withdraw'?'withdraw':'withdraw_reserve',{amount},'1','Withdraw test USDC; inspect final callback before treating as paid')];}
    if(action==='result'){
      if(who!==this.config.reporterId||!result)throw new Error('The configured reporter must approve the closed paper result.');
      if(!state.contractState)throw new Error('Testnet clearing not observed.');
      const target=String(result.account_id),claim=(await this.view(contract,'get_claim',{account_id:target})).value;
      if(!claim||claim.pending||claim.claim!==result.expected_claim||claim.session_id!==result.session_id)throw new Error('Testnet claim changed; this paper result cannot be applied.');
      const gain=units(result.new_claim)-units(result.expected_claim);if(gain>units(state.contractState.reserve))throw new Error('Insufficient testnet surplus for this simulated gain.');
      return [this.call(who,contract,'record_result',result,'0','Record trusted simulated result; gains use the demo surplus')];
    }
    throw new Error('Unsupported testnet action.');
  }
  async receipt(hash:string,who:string){
    testAccount(who);if(!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(hash))throw new Error('Invalid NEAR transaction hash.');
    const r=await this.rpc('tx',{tx_hash:hash,sender_account_id:who,wait_until:'FINAL'});
    if(r.final_execution_status!=='FINAL')return {status:'pending',hash};
    if(r.transaction?.signer_id!==who||![TEST_USDC,this.config.contractId].includes(r.transaction?.receiver_id))throw new Error('Transaction is outside this demo.');
    const outcomes=[r.transaction_outcome,...(r.receipts_outcome??[])];
    return {status:outcomes.some((o:any)=>o.outcome?.status?.Failure)?'failed':'final',hash,scope:'NEAR testnet transfer/callback outcomes; paper trading remains simulated.',observation:await this.inspect(who)};
  }
}
