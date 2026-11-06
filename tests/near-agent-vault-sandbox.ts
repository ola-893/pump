// Local-only integration acceptance. No public RPC or user credentials are used.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Account, JsonRpcProvider, KeyPair, actions } from 'near-api-js';
import {ownedVaultAccount} from '../near-demo/agent-vaults.js';
import {vaultReceiptEffect} from '../near-demo/vault-receipt.js';
import { TEST_USDC } from '../near-demo/types.js';

const binary=process.env.NEAR_SANDBOX_BIN;
if(!binary)throw new Error('Set NEAR_SANDBOX_BIN to the official near-sandbox executable.');
const home=mkdtempSync(join(tmpdir(),'pumpcoin-near-acceptance-'));
const init=spawnSync(binary,['--home',home,'init'],{encoding:'utf8'});
if(init.status!==0)throw new Error(`Sandbox initialization failed: ${init.stderr}`);
const ids=['controller.testnet','alice.testnet','bob.testnet',TEST_USDC];
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
const owner='controller.testnet',alice='alice.testnet',bob='bob.testnet';
const vaults=['katana.controller.testnet','okina.controller.testnet'];
const agentIds=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
const wasm=readFileSync(resolve('contracts-near/target/wasm32-unknown-unknown/release/pump_agent_vault.wasm'));
const observations:unknown[]=[];
async function checkpoint(label:string){const states=[];for(const v of vaults){const s=await view(v,'get_state'),balance=await view(TEST_USDC,'ft_balance_of',{account_id:v});assert.equal(BigInt(balance),BigInt(s.assets)+BigInt(s.reserve)+BigInt(s.pending?.assets??0),label);states.push({vault:v,state:s,balance});}observations.push({label,states});}
async function transfer(v:string,who:string,amount:string,kind='deposit'){const s=await view(v,'get_state');return call(who,TEST_USDC,'ft_transfer_call',{receiver_id:v,amount,msg:JSON.stringify(kind==='reserve'?{kind}:{kind,min_shares:'1',expected_nonce:s.nonce})},1n);}
async function begin(v:string){const s=await view(v,'get_state');return call(owner,v,'begin_round',{run_id:s.strategy_id,strategy_hash:s.strategy_hash,reference_equity:'100000000',start_sequence:0,expected_nonce:s.nonce});}
async function settle(v:string,ending:string){const s=await view(v,'get_state');return call(owner,v,'settle_round',{run_id:s.strategy_id,ending_equity:ending,sequence:2,evidence_hash:'c'.repeat(64),expected_nonce:s.nonce});}
async function redeem(v:string,who:string,shares:string){const s=await view(v,'get_state');return call(who,v,'redeem',{shares,min_assets:'0',expected_nonce:s.nonce},1n);}
try{
 let ready=false;for(let n=0;n<100;n++){try{const r=await fetch(endpoint+'/status');if(r.ok){ready=true;break;}}catch{}if(node.exitCode!==null)throw new Error('Sandbox exited: '+home);await new Promise(r=>setTimeout(r,200));}assert.ok(ready);
 await account(TEST_USDC).signAndSendTransaction({receiverId:TEST_USDC,actions:[actions.deployContract(readFileSync(resolve('contracts-near/target/wasm32-unknown-unknown/release/pumpcoin_sandbox_token.wasm'))),actions.functionCall('new',{owner_id:owner},50000000000000n,0n)],waitUntil:'FINAL'});
 for(let i=0;i<vaults.length;i++){await account(owner).signAndSendTransaction({receiverId:vaults[i],actions:[actions.createAccount(),actions.transfer(10n*10n**24n),actions.deployContract(wasm),actions.functionCall('new',{agent_id:agentIds[0],manifest_hash:'a'.repeat(64),strategy_id:agentIds[i],strategy_hash:'b'.repeat(64),name:'katana',controller_id:owner,reporter_id:owner},60000000000000n,0n)],waitUntil:'FINAL'});assert.equal((await provider.viewAccessKeyList({accountId:vaults[i],finalityQuery:{finality:'final'}})).keys.length,0);}
 for(const who of [owner,alice,bob,...vaults])await call(owner,TEST_USDC,'storage_deposit',{account_id:who,registration_only:true},10n**23n);
 for(const who of [owner,alice,bob])await call(owner,TEST_USDC,'mint',{account_id:who,amount:'100000000'});
 for(const v of vaults)for(const who of [alice,bob])await call(who,v,'storage_deposit',{account_id:who,registration_only:true},10n**23n);
 await transfer(vaults[0],owner,'30000000','reserve');await transfer(vaults[1],owner,'40000000','reserve');
 const actualDeposit=await transfer(vaults[0],alice,'20000000');assert.equal(vaultReceiptEffect(actualDeposit,alice,vaults[0]).outcome,'confirmed');await transfer(vaults[0],bob,'20000000');await transfer(vaults[1],alice,'10000000');
 assert.equal(await view(vaults[0],'ft_balance_of',{account_id:alice}),'20000000');assert.equal(await view(vaults[1],'ft_balance_of',{account_id:alice}),'10000000');await checkpoint('Isolated deposits and per-strategy pump coin balances');
 const otherBefore=await view(vaults[1],'get_state');await begin(vaults[0]);const walletBefore=await view(TEST_USDC,'ft_balance_of',{account_id:alice});const actualRefund=await transfer(vaults[0],alice,'5000000');assert.equal(vaultReceiptEffect(actualRefund,alice,vaults[0]).outcome,'refunded');assert.equal(await view(TEST_USDC,'ft_balance_of',{account_id:alice}),walletBefore);await assert.rejects(redeem(vaults[0],alice,'1000000'),/Paper round active/);
 await assert.rejects(call(bob,vaults[0],'settle_round',{run_id:agentIds[0],ending_equity:'110000000',sequence:1,evidence_hash:'c'.repeat(64),expected_nonce:(await view(vaults[0],'get_state')).nonce}),/Reporter only/);
 await settle(vaults[0],'110000000');assert.equal((await view(vaults[0],'get_state')).assets,'44000000');assert.deepEqual(await view(vaults[1],'get_state'),otherBefore);await transfer(vaults[0],bob,'11000000');assert.equal(await view(vaults[0],'ft_balance_of',{account_id:bob}),'30000000');await checkpoint('Proportional gain consumes only Katana reserve; late deposit uses current NAV');
 const actualWithdrawal=await redeem(vaults[0],alice,'10000000');assert.equal(vaultReceiptEffect(actualWithdrawal,alice,vaults[0]).outcome,'confirmed');assert.equal(await view(vaults[0],'ft_balance_of',{account_id:alice}),'10000000');await checkpoint('Redeem burns shares and pays actual fixture tokens');
 await call(alice,TEST_USDC,'storage_unregister',{force:true},1n);const before=await view(vaults[0],'get_state');const actualRestoration=await redeem(vaults[0],alice,'10000000');assert.equal(vaultReceiptEffect(actualRestoration,alice,vaults[0]).outcome,'restored');assert.equal(await view(vaults[0],'ft_balance_of',{account_id:alice}),'10000000');const after=await view(vaults[0],'get_state');assert.equal(after.assets,before.assets);assert.equal(after.total_supply,before.total_supply);assert.equal(after.pending,null);await checkpoint('Failed token transfer restores exactly the burned shares and assets');
 await call(alice,TEST_USDC,'storage_deposit',{account_id:alice,registration_only:true},10n**23n);await redeem(vaults[0],alice,'10000000');assert.equal(await view(TEST_USDC,'ft_balance_of',{account_id:alice}),'11000000');
 await begin(vaults[1]);await settle(vaults[1],'90000000');assert.equal((await view(vaults[1],'get_state')).assets,'9000000');assert.equal((await view(vaults[1],'get_state')).reserve,'41000000');await checkpoint('Second strategy loss replenishes only its own reserve');
 await call(bob,vaults[0],'ft_transfer',{receiver_id:alice,amount:'5000000'},1n);assert.equal(await view(vaults[0],'ft_balance_of',{account_id:alice}),'5000000');assert.equal(await view(vaults[1],'ft_balance_of',{account_id:alice}),'10000000');await checkpoint('Transferable shares preserve separation between strategies');
 const factory='pl.'+owner;
 const factoryWasm=readFileSync(resolve('contracts-near/target/wasm32-unknown-unknown/release/pump_vault_factory.wasm'));
 await account(owner).signAndSendTransaction({receiverId:factory,actions:[
   actions.createAccount(),actions.transfer(10n*10n**24n),actions.deployContract(factoryWasm),
   actions.functionCall('new',{vault_code:wasm.toString('base64'),reporter:owner},120_000_000_000_000n,0n),
 ],waitUntil:'FINAL'});
 const funding=BigInt(await view(factory,'funding'));
 assert.equal((await provider.viewAccessKeyList({accountId:factory,finalityQuery:{finality:'final'}})).keys.length,0);
 async function deployOwned(id:string,publicVault:boolean,previous:string|null=null){
   const target=ownedVaultAccount(id,alice,factory);
   const action=actions.functionCall('deploy',{agent_id:agentIds[0],manifest_hash:'a'.repeat(64),
     strategy_id:id,strategy_hash:'d'.repeat(64),name:'katana',initial_equity:'100000000',public:publicVault&&!previous,
     open_after_archive:publicVault&&!!previous,previous_vault:previous},220_000_000_000_000n,funding);
   await account(alice).signAndSendTransaction({receiverId:factory,actions:[action],waitUntil:'FINAL'});
   const state=await view(target,'get_state');
   assert.equal(state.version,'PUMP-STRATEGY-VAULT-v4');
   assert.equal(state.controller_id,alice);
   assert.equal(state.strategy_id,id);
   assert.equal(state.public,publicVault);
   assert.equal((await provider.viewAccessKeyList({accountId:target,finalityQuery:{finality:'final'}})).keys.length,0);
   return target;
 }
 const firstOwned=await deployOwned(agentIds[0],true);
 for(const v of [firstOwned]) {
   await call(owner,TEST_USDC,'storage_deposit',{account_id:v,registration_only:true},10n**23n);
   await call(bob,v,'storage_deposit',{account_id:bob,registration_only:true},10n**23n);
 }
 await transfer(firstOwned,bob,'1000000');
 await assert.rejects(call(bob,firstOwned,'archive',{agent_id:agentIds[0]}),/Owner only/);
 // Real token custody follows live marks while the paper position may remain open.
 await transfer(firstOwned,alice,'1000000','reserve');
 async function liveReport(equity:string,sequence:number,tracking:boolean){
   const state=await view(firstOwned,'get_state');
   await call(owner,firstOwned,'report_nav',{run_id:agentIds[0],strategy_hash:'d'.repeat(64),
     equity,sequence,observed_at_ms:Date.now()-1000,evidence_hash:'e'.repeat(64),
     tracking,expected_nonce:state.nonce});
 }
 await liveReport('99000000',1,true);
 assert.equal((await view(firstOwned,'get_state')).assets,'990000');
 assert.equal(await view(firstOwned,'preview_redeem',{shares:'1000000'}),'990000');
 await liveReport('101000000',2,true);
 assert.equal((await view(firstOwned,'get_state')).assets,'1010000');
 assert.equal(await view(firstOwned,'preview_redeem',{shares:'1000000'}),'1010000');
 // A payout must match the current price, including real FT callback effects.
 const bobBeforeGain=BigInt(await view(TEST_USDC,'ft_balance_of',{account_id:bob}));
 const gainReceipt=await redeem(firstOwned,bob,'500000');
 assert.equal(vaultReceiptEffect(gainReceipt,bob,firstOwned).assets,'505000');
 assert.equal(BigInt(await view(TEST_USDC,'ft_balance_of',{account_id:bob}))-bobBeforeGain,505000n);
 // A second investor pays the current 1.01 NAV; they do not inherit earlier gains.
 await call(alice,firstOwned,'storage_deposit',{account_id:alice,registration_only:true},10n**23n);
 await transfer(firstOwned,alice,'1010000');
 assert.equal(await view(firstOwned,'ft_balance_of',{account_id:alice}),'1000000');
 await liveReport('99000000',3,true);
 const bobBeforeLoss=BigInt(await view(TEST_USDC,'ft_balance_of',{account_id:bob}));
 const lossReceipt=await redeem(firstOwned,bob,'500000');
 assert.equal(vaultReceiptEffect(lossReceipt,bob,firstOwned).assets,'495000');
 assert.equal(BigInt(await view(TEST_USDC,'ft_balance_of',{account_id:bob}))-bobBeforeLoss,495000n);
 const aliceBeforeLoss=BigInt(await view(TEST_USDC,'ft_balance_of',{account_id:alice}));
 const aliceLoss=await redeem(firstOwned,alice,'1000000');
 assert.equal(vaultReceiptEffect(aliceLoss,alice,firstOwned).assets,'990000');
 assert.equal(BigInt(await view(TEST_USDC,'ft_balance_of',{account_id:alice}))-aliceBeforeLoss,990000n);
 const empty=await view(firstOwned,'get_state');
 assert.equal(empty.assets,'0');assert.equal(empty.total_supply,'0');
 assert.equal(BigInt(await view(TEST_USDC,'ft_balance_of',{account_id:firstOwned})),BigInt(empty.reserve));
 await liveReport('100000000',4,false);
 // Recover an ambiguous submission using the exact same signed transaction.
 const stateForRetry=await view(firstOwned,'get_state');
 const retryTx=await account(bob).createSignedTransaction({receiverId:TEST_USDC,actions:[actions.functionCall('ft_transfer_call',{
   receiver_id:firstOwned,amount:'1000000',msg:JSON.stringify({kind:'deposit',min_shares:'1000000',expected_nonce:stateForRetry.nonce}),
 },100_000_000_000_000n,1n)]});
 const firstReceipt=await provider.sendTransactionUntil(retryTx,'FINAL');
 const beforeRetry=await view(TEST_USDC,'ft_balance_of',{account_id:bob});
 try{await provider.sendTransactionUntil(retryTx,'FINAL');}catch{/* A replay may be rejected by nonce; balances must still be unchanged. */}
 assert.equal(await view(TEST_USDC,'ft_balance_of',{account_id:bob}),beforeRetry);
 assert.equal(await view(firstOwned,'ft_balance_of',{account_id:bob}),'1000000');
 assert.equal(vaultReceiptEffect(firstReceipt,bob,firstOwned).outcome,'confirmed');
 console.log('PASS: live NAV gain/loss payouts, fair late entry, full exit conservation, and ambiguous signed submission recovery without duplicate deposit.');
 const secondOwned=await deployOwned(agentIds[1],true,firstOwned);
 assert.notEqual(firstOwned,secondOwned);
 assert.equal((await view(firstOwned,'get_state')).archived,true);
 assert.equal(vaultReceiptEffect(await transfer(firstOwned,bob,'1000000'),bob,firstOwned).outcome,'refunded');
 await assert.rejects(begin(firstOwned),/Live vaults use automatic NAV reports/);
 assert.equal(vaultReceiptEffect(await redeem(firstOwned,bob,'1000000'),bob,firstOwned).outcome,'confirmed');
 const privateOwned=await deployOwned('00000000-0000-4000-8000-000000000003',false,secondOwned);
 assert.equal((await view(secondOwned,'get_state')).archived,true);
 await call(owner,TEST_USDC,'storage_deposit',{account_id:privateOwned,registration_only:true},10n**23n);
 await call(bob,privateOwned,'storage_deposit',{account_id:bob,registration_only:true},10n**23n);
 assert.equal(vaultReceiptEffect(await transfer(privateOwned,bob,'1000000'),bob,privateOwned).outcome,'refunded');
 await call(alice,privateOwned,'publish',{});
 assert.equal(vaultReceiptEffect(await transfer(privateOwned,bob,'1000000'),bob,privateOwned).outcome,'confirmed');
 console.log('PASS: owner-funded factory deploys separate keyless vaults, archives the previous version, and preserves redemption and private funding rules.');
 const seedFactory='ps.'+owner;
 await account(owner).signAndSendTransaction({receiverId:seedFactory,actions:[
   actions.createAccount(),actions.transfer(10n*10n**24n),actions.deployContract(factoryWasm),
   actions.functionCall('new',{vault_code:wasm.toString('base64'),reporter:owner},120_000_000_000_000n,0n),
 ],waitUntil:'FINAL'});
 const seedId='00000000-0000-4000-8000-000000000004', seedAmount='2000000', seeded=ownedVaultAccount(seedId,alice,seedFactory);
 await account(alice).signAndSendTransaction({receiverId:seedFactory,actions:[actions.functionCall('deploy_seeded',{
   agent_id:agentIds[0],manifest_hash:'a'.repeat(64),strategy_id:seedId,strategy_hash:'d'.repeat(64),seed:seedAmount,
 },220_000_000_000_000n,BigInt(await view(seedFactory,'funding')))],waitUntil:'FINAL'});
 assert.equal((await provider.viewAccessKeyList({accountId:seeded,finalityQuery:{finality:'final'}})).keys.length,0);
 assert.equal((await view(seeded,'get_state')).public,false);
 assert.equal((await view(seeded,'get_state')).assets,'0');
 assert.deepEqual(await view(seeded,'seed_funding'),{required:seedAmount,received:'0'});
 await call(alice,TEST_USDC,'storage_deposit',{account_id:seeded,registration_only:true},10n**23n);
 const seed=(who:string,amount:string)=>call(who,TEST_USDC,'ft_transfer_call',{receiver_id:seeded,amount,msg:'{"kind":"seed"}'},1n);
 const balanceOf=(id:string)=>view(TEST_USDC,'ft_balance_of',{account_id:id});
 const ownerBefore=BigInt(await balanceOf(alice)),investorBefore=await balanceOf(bob);
 await seed(bob,seedAmount);
 await seed(alice,'1999999');
 assert.equal(await balanceOf(bob),investorBefore);
 assert.equal(BigInt(await balanceOf(alice)),ownerBefore);
 assert.equal(await balanceOf(seeded),'0');
 await seed(alice,seedAmount);
 await seed(alice,seedAmount);
 assert.deepEqual(await view(seeded,'seed_funding'),{required:seedAmount,received:seedAmount});
 assert.equal(await balanceOf(seeded),seedAmount);
 assert.equal(BigInt(await balanceOf(alice)),ownerBefore-BigInt(seedAmount));
 await assert.rejects(call(alice,seeded,'publish',{}),/closed to investors/);
 await redeem(seeded,alice,seedAmount);
 assert.equal(await balanceOf(seeded),'0');
 assert.equal(BigInt(await balanceOf(alice)),ownerBefore);
 await seed(alice,seedAmount);
 assert.equal(await balanceOf(seeded),'0');
 assert.equal((await view(seeded,'seed_funding')).received,seedAmount);
 console.log('PASS: zero initial balance, exact owner seed, third-party and duplicate refunds, and owner withdrawal on NEAR Sandbox.');
 if(!process.argv.includes('--skip-evidence'))writeFileSync(resolve('docs/testing/near-agent-vault-sandbox.json'),JSON.stringify({at:new Date().toISOString(),environment:'local NEAR Sandbox 2.13.4',token:'Sandbox FT fixture only, NOT Circle-issued USDC',observations},null,2)+'\n');
 console.log('PASS: keyless isolated WASM vaults, real FT mint/deposit/redemption callbacks, gain/loss conservation, same-wallet multi-strategy ownership, failed payout restoration, transferable shares.');
}finally{node.kill('SIGTERM');await new Promise<void>(r=>node.exitCode!==null?r():node.once('exit',()=>r()));closeSync(log);}
