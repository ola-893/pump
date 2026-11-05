// One-time installation of the keyless TESTNET factory. Review without --broadcast.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Account, JsonRpcProvider, SignedTransaction, actions, baseEncode } from 'near-api-js';
import { TestnetDemo } from './testnet.js';
import { TESTNET_RPC, type TestnetConfig } from './types.js';
import type { VaultConfig } from './agent-vaults.js';

const cfgPath = 'deployments/near-agent-vaults.json';
const cfg = JSON.parse(readFileSync(cfgPath,'utf8')) as VaultConfig;
const network = JSON.parse(readFileSync('deployments/near-demo-testnet.json','utf8')) as TestnetConfig;
if(cfg.network!=='testnet'||network.network!=='testnet'||!/^pumpcoin-demo-[a-f0-9]{6}\.testnet$/.test(cfg.parentId))
  throw new Error('Only the reviewed Pump testnet deployment account can install this factory.');
const wasmDir='contracts-near/target/wasm32-unknown-unknown/release/';
const factoryCode=readFileSync(wasmDir+'pump_vault_factory.wasm');
const vaultCode=readFileSync(wasmDir+'pump_agent_vault.wasm');
const codeHash=(code:Buffer)=>baseEncode(createHash('sha256').update(code).digest());
const storagePerByte=10n**19n, buffer=3n*10n**23n;
const funding=BigInt(vaultCode.length+factoryCode.length)*storagePerByte+buffer;
const factory={liveNav:true,reporterId:cfg.parentId,id:'pl.'+cfg.parentId,codeHash:codeHash(factoryCode),vaultCodeHash:codeHash(vaultCode),
  funding:String(BigInt(vaultCode.length)*storagePerByte+buffer)};
if(funding>8n*10n**24n || BigInt(factory.funding)>5n*10n**24n)
  throw new Error('WASM exceeds the reviewed storage funding limits.');
const provider=new JsonRpcProvider({url:TESTNET_RPC});
const read=(accountId:string)=>provider.viewAccount({accountId,blockQuery:{finality:'final'}});
const parent=await read(cfg.parentId);
const spendable=parent.amount-BigInt(parent.storage_usage)*storagePerByte;
const plan={network:'testnet',parentId:cfg.parentId,factory,reporter:factory.reporterId,
  factoryAccountFunding:String(funding),parentSpendable:String(spendable)};
const journal='.local/near-demo/live-factory-install';
if(!process.argv.includes('--broadcast')){
  writeFileSync(journal+'.plan.json',JSON.stringify(plan,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(plan,null,2));
  process.exit(0);
}
const reviewed=JSON.parse(readFileSync(journal+'.plan.json','utf8'));
if(reviewed.parentId!==plan.parentId||reviewed.reporter!==plan.reporter||
   reviewed.factoryAccountFunding!==plan.factoryAccountFunding||JSON.stringify(reviewed.factory)!==JSON.stringify(factory))
  throw new Error('Factory installation differs from the reviewed plan.');
let target;
try{target=await read(factory.id);}catch(e){if(!/does not exist|UNKNOWN_ACCOUNT/i.test(String(e)))throw e;}
if(!target){
  if(spendable<funding+5n*10n**22n)throw new Error('The testnet deployer needs additional test NEAR for the one-time factory installation.');
  const credential=JSON.parse(readFileSync('.local/near-demo/testnet-deployer.json','utf8'));
  if(credential.network!=='testnet'||credential.account_id!==cfg.parentId)throw new Error('Unexpected testnet signer.');
  let tx:SignedTransaction;
  const signedPath=journal+'.signed.json';
  if(existsSync(signedPath)){
    const previous=JSON.parse(readFileSync(signedPath,'utf8'));
    if(previous.codeHash!==factory.codeHash||previous.vaultCodeHash!==factory.vaultCodeHash)
      throw new Error('A different factory installation is already journaled.');
    tx=SignedTransaction.decode(Buffer.from(previous.signed,'base64'));
  }else{
    const signer=new Account(cfg.parentId,provider,credential.private_key);
    tx=await signer.createSignedTransaction({receiverId:factory.id,actions:[
      actions.createAccount(),actions.transfer(funding),actions.deployContract(factoryCode),
      actions.functionCall('new',{vault_code:vaultCode.toString('base64'),reporter:factory.reporterId},120_000_000_000_000n,0n),
    ]});
    writeFileSync(signedPath,JSON.stringify({...factory,signed:Buffer.from(tx.encode()).toString('base64')}),{mode:0o600,flag:'wx'});
  }
  const receipt=await provider.sendTransactionUntil(tx,'FINAL');
  writeFileSync(journal+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
  if(receipt.final_execution_status!=='FINAL'||typeof receipt.status!=='object'||!('SuccessValue' in receipt.status)||
     receipt.receipts_outcome.some(r=>typeof r.outcome.status==='object'&&'Failure' in r.outcome.status))
    throw new Error('Factory installation is unconfirmed. Inspect the journal before retrying.');
  target=await read(factory.id);
}
const demo=new TestnetDemo(network);
const [keys, observedFunding, observedVaultCode, observedReporter]=await Promise.all([
  provider.viewAccessKeyList({accountId:factory.id,finalityQuery:{finality:'final'}}),
  demo.view(factory.id,'funding'),demo.view(factory.id,'vault_code_hash'),demo.view(factory.id,'reporter_id'),
]);
if(observedReporter.value!==factory.reporterId||target.code_hash!==factory.codeHash||keys.keys.length!==0||observedFunding.value!==factory.funding||
   baseEncode(Buffer.from(observedVaultCode.value,'base64'))!==factory.vaultCodeHash)
  throw new Error('Factory code, child code, keylessness or funding differed from the reviewed plan.');
writeFileSync(cfgPath,JSON.stringify({...JSON.parse(readFileSync(cfgPath,'utf8')),factory},null,2)+'\n');
console.log(JSON.stringify({network:'testnet',factory,verified:true},null,2));
