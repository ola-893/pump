// Local-only integration acceptance. No public RPC or user credentials are used.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
import { TEST_USDC } from '../near-demo/types.js';

const binary=process.env.NEAR_SANDBOX_BIN;
if(!binary)throw new Error('Set NEAR_SANDBOX_BIN to the official near-sandbox executable.');
const home=mkdtempSync(join(tmpdir(),'pumpcoin-near-acceptance-'));
const init=spawnSync(binary,['--home',home,'init'],{encoding:'utf8'});
if(init.status!==0)throw new Error(`Sandbox initialization failed: ${init.stderr}`);
const ids=['clearing.testnet','controller.testnet','alice.testnet','bob.testnet',TEST_USDC];
const keys=new Map(ids.map(id=>[id,KeyPair.fromRandom('ed25519')]));
const genesis=JSON.parse(readFileSync(join(home,'genesis.json'),'utf8'));
const balance=1000n*10n**24n;
for(const id of ids){
  genesis.records.push({Account:{account_id:id,account:{amount:String(balance),locked:'0',code_hash:'11111111111111111111111111111111',storage_usage:0,version:'V1'}}});
  genesis.records.push({AccessKey:{account_id:id,public_key:keys.get(id)!.getPublicKey().toString(),access_key:{nonce:0,permission:'FullAccess'}}});
}
genesis.total_supply=String(BigInt(genesis.total_supply)+balance*BigInt(ids.length));
writeFileSync(join(home,'genesis.json'),JSON.stringify(genesis));
const config=JSON.parse(readFileSync(join(home,'config.json'),'utf8'));
config.rpc.addr='127.0.0.1:19347';config.rpc.cors_allowed_origins=[];
config.network.addr='127.0.0.1:19348';config.network.trusted_stun_servers=[];
config.network.experimental.inbound_disabled=true;
config.network.experimental.network_config_overrides.outbound_disabled=true;
config.consensus.min_num_peers=0;
writeFileSync(join(home,'config.json'),JSON.stringify(config));
const log=openSync(join(home,'sandbox.log'),'w');
const node=spawn(binary,['--home',home,'run'],{stdio:['ignore',log,log],env:{...process.env,RUST_LOG:'warn'}});
const endpoint='http://127.0.0.1:19347';
const provider=new JsonRpcProvider({url:endpoint});
const account=(id:string)=>new Account(id,provider,keys.get(id)!.toString());
const call=async(who:string,target:string,method:string,args:object,deposit=0n)=>account(who).signAndSendTransaction({receiverId:target,actions:[actions.functionCall(method,args,100_000_000_000_000n,deposit)],waitUntil:'FINAL'});
const view=async(target:string,method:string,args:object={})=>{
  const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'acceptance',method:'query',params:{request_type:'call_function',finality:'final',account_id:target,method_name:method,args_base64:Buffer.from(JSON.stringify(args)).toString('base64')}})});
  const data=await r.json() as any;if(data.error)throw new Error(JSON.stringify(data.error));return JSON.parse(Buffer.from(data.result.result).toString());
};
const clearing='clearing.testnet',controller='controller.testnet',alice='alice.testnet',bob='bob.testnet';
const observations:object[]=[];
async function checkpoint(label:string){
  const state=await view(clearing,'get_state'),held=await view(TEST_USDC,'ft_balance_of',{account_id:clearing});
  assert.equal(BigInt(held),BigInt(state.reserve)+BigInt(state.total_claims)+BigInt(state.in_flight),label);
  observations.push({label,state,tokenBalance:held});
}
try {
  let ready=false;
  for(let n=0;n<100;n++){try{const r=await fetch(endpoint+'/status');if(r.ok){ready=true;break;}}catch{}if(node.exitCode!==null)throw new Error('Sandbox exited; inspect '+join(home,'sandbox.log'));await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,'Sandbox RPC did not become ready');
  for(const [id,file,args] of [[TEST_USDC,'pumpcoin_sandbox_token.wasm',{owner_id:controller}],[clearing,'pumpcoin_demo_clearing.wasm',{controller_id:controller,reporter_id:controller}]] as const){
    await account(id).signAndSendTransaction({receiverId:id,actions:[actions.deployContract(readFileSync(resolve('contracts-near/target/wasm32-unknown-unknown/release',file))),actions.functionCall('new',args,50_000_000_000_000n,0n)],waitUntil:'FINAL'});
  }
  for(const id of [controller,alice,bob,clearing])await call(controller,TEST_USDC,'storage_deposit',{account_id:id,registration_only:true},10n**23n);
  for(const id of [controller,alice,bob])await call(controller,TEST_USDC,'mint',{account_id:id,amount:'100000000'});
  for(const id of [alice,bob])await call(id,clearing,'register',{},20_000_000_000_000_000_000_000n);
  const deposit=async(who:string,amount:string,msg:object)=>call(who,TEST_USDC,'ft_transfer_call',{receiver_id:clearing,amount,msg:JSON.stringify(msg)},1n);
  const session='00000000-0000-4000-8000-000000000001';
  await deposit(controller,'30000000',{kind:'reserve'});
  await deposit(alice,'20000000',{kind:'deposit',session_id:session});
  await checkpoint('20 test USDC claim + 30 separate reserve');
  const result={account_id:alice,session_id:session,expected_claim:'20000000',new_claim:'22000000',sequence:3,evidence_hash:'a'.repeat(64)};
  await assert.rejects(call(bob,clearing,'record_result',result),/Reporter only/);
  await call(controller,clearing,'record_result',result);
  await assert.rejects(call(controller,clearing,'record_result',{...result,expected_claim:'22000000'}),/already processed/);
  await checkpoint('simulated gain consumes 2 reserve');
  assert.equal((await view(clearing,'get_state')).reserve,'28000000');
  // Remove Alice's FT registration to force the outgoing transfer to fail.
  await call(alice,TEST_USDC,'storage_unregister',{force:true},1n);
  await call(alice,clearing,'withdraw',{amount:'22000000'},1n);
  const restored=await view(clearing,'get_claim',{account_id:alice});
  assert.equal(restored.claim,'22000000');assert.equal(restored.pending,null);
  await checkpoint('failed FT transfer callback restores full claim');
  await call(alice,TEST_USDC,'storage_deposit',{account_id:alice,registration_only:true},10n**23n);
  await call(alice,clearing,'withdraw',{amount:'22000000'},1n);
  assert.equal(await view(TEST_USDC,'ft_balance_of',{account_id:alice}),'22000000');
  assert.equal((await view(clearing,'get_claim',{account_id:alice})).claim,'0');
  await checkpoint('principal + simulated gain paid; claim zero');
  await deposit(bob,'20000000',{kind:'deposit',session_id:session});
  await call(controller,clearing,'record_result',{...result,account_id:bob,new_claim:'19000000',sequence:4});
  await checkpoint('simulated loss increases reserve by 1');
  assert.equal((await view(clearing,'get_state')).reserve,'29000000');
  await assert.rejects(call(controller,clearing,'withdraw_reserve',{amount:'29000001'},1n),/Insufficient free reserve/);
  await call(controller,clearing,'withdraw_reserve',{amount:'29000000'},1n);
  await checkpoint('controller can withdraw free reserve without spending claims');
  const before=await view(TEST_USDC,'ft_balance_of',{account_id:bob});
  await deposit(bob,'1000000',{kind:'unknown'});
  assert.equal(await view(TEST_USDC,'ft_balance_of',{account_id:bob}),before);
  await checkpoint('unsupported transfer-call refunded');
  const report={date:new Date().toISOString(),environment:'local NEAR Sandbox only',binaryVersion:'2.13.4',fixture:'Sandbox FT fixture at pinned token ID; NOT Circle-issued',checks:observations};
  writeFileSync(resolve('docs/testing/near-sandbox-acceptance.json'),JSON.stringify(report,null,2)+'\n');
  console.log('PASS: deployed WASM, real FT callbacks, gain/loss reserve accounting, failed payout restoration, replay rejection, authorized reserve withdrawal, refunds.');
} finally {node.kill('SIGTERM');await new Promise<void>(r=>node.exitCode!==null?r():node.once('exit',()=>r()));closeSync(log);}
