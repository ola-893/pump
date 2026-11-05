import { TESTNET_RPC } from './types.js';
// Deploys only the reviewed plan to the newly generated local testnet account.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Account, JsonRpcProvider, SignedTransaction, actions, baseEncode } from 'near-api-js';
import { TestnetDemo } from './testnet.js';
import type { TestnetConfig } from './types.js';
if(process.argv[2]!=='--broadcast')throw new Error('Review npm run demo:deploy-plan first. Explicit --broadcast is required.');
const directory='.local/near-demo',plan=JSON.parse(readFileSync(directory+'/deploy-plan.json','utf8'));
const credential=JSON.parse(readFileSync(directory+'/testnet-deployer.json','utf8'));
const config=JSON.parse(readFileSync('deployments/near-demo-testnet.json','utf8')) as TestnetConfig;
const target=plan.contractId;
new TestnetDemo({...config,contractId:target});
if(credential.network!=='testnet'||plan.network!=='testnet'||plan.exampleOnly||!/^pumpcoin-demo-[a-f0-9]{6}\.testnet$/.test(target)||target!==credential.account_id||plan.init.controller_id!==config.controllerId||plan.init.reporter_id!==config.reporterId)throw new Error('Deployment differs from the reviewed testnet plan.');
const wasm=readFileSync(plan.wasm);
if(createHash('sha256').update(wasm).digest('hex')!==plan.sha256||wasm.length!==plan.bytes)throw new Error('WASM changed since plan preparation.');
const provider=new JsonRpcProvider({url:TESTNET_RPC}),pending=directory+'/deployment-submitted.json';
let signed:SignedTransaction;
if(existsSync(pending)){
  const old=JSON.parse(readFileSync(pending,'utf8'));
  if(old.contractId!==target||old.sha256!==plan.sha256)throw new Error('A different deployment is already journaled.');
  // Resume the exact signed bytes; never replace a possibly submitted transaction.
  signed=SignedTransaction.decode(Buffer.from(old.signedBase64,'base64'));
}else{
  const state=await provider.viewAccount({accountId:target,blockQuery:{finality:'final'}});
  if(state.code_hash!=='11111111111111111111111111111111'||state.amount<10n**24n)throw new Error('Target must be an empty contract account with at least one test NEAR.');
  const account=new Account(target,provider,credential.private_key);
  signed=await account.createSignedTransaction({receiverId:target,actions:[actions.deployContract(wasm),actions.functionCall('new',plan.init,50_000_000_000_000n,0n)]});
  const hash=baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
  writeFileSync(pending,JSON.stringify({network:'testnet',contractId:target,sha256:plan.sha256,hash,signedBase64:Buffer.from(signed.encode()).toString('base64'),at:new Date().toISOString()},null,2)+'\n',{mode:0o600,flag:'wx'});
}
const receipt=await provider.sendTransactionUntil(signed,'FINAL');
writeFileSync(directory+'/deployment-receipt.json',JSON.stringify(receipt,null,2)+'\n');
if(receipt.final_execution_status!=='FINAL'||typeof receipt.status!=='object'||!('SuccessValue' in receipt.status)||receipt.receipts_outcome.some(r=>typeof r.outcome.status==='object'&&'Failure' in r.outcome.status))throw new Error('Deployment is not confirmed successful. Inspect saved receipt; do not create a replacement transaction.');
const deployed={...config,contractId:target};
const observation=await new TestnetDemo(deployed).inspect();
const code=await provider.viewAccount({accountId:target,blockQuery:{finality:'final'}});
if(code.code_hash!==baseEncode(createHash('sha256').update(wasm).digest()))throw new Error('Observed contract code differs from the reviewed WASM.');
writeFileSync('deployments/near-demo-testnet.json',JSON.stringify(deployed,null,2)+'\n');
writeFileSync('docs/testing/near-testnet-deployment.json',JSON.stringify({network:'testnet',contractId:target,transactionHash:receipt.transaction.hash,wasmSha256:plan.sha256,codeHash:code.code_hash,observation},null,2)+'\n');
console.log(JSON.stringify({network:'testnet',contractId:target,transactionHash:receipt.transaction.hash,status:'FINAL',codeHash:code.code_hash,state:observation.contractState},null,2));
