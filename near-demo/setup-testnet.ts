import { TESTNET_RPC } from './types.js';
// Bounded setup for the deployed testnet demo: activate its controller and register FT storage.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Account, JsonRpcProvider, SignedTransaction, actions, baseEncode, type Action } from 'near-api-js';
import { TestnetDemo } from './testnet.js';
import { TEST_USDC, type TestnetConfig } from './types.js';
if(process.argv[2]!=='--broadcast')throw new Error('Explicit --broadcast required; testnet gas and Circle FT storage only.');
const config=JSON.parse(readFileSync('deployments/near-demo-testnet.json','utf8')) as TestnetConfig;
const credential=JSON.parse(readFileSync('.local/near-demo/testnet-deployer.json','utf8'));
if(credential.network!=='testnet'||config.contractId!==credential.account_id||!/^pumpcoin-demo-[a-f0-9]{6}\.testnet$/.test(credential.account_id)||!/^[a-f0-9]{64}$/.test(config.controllerId))throw new Error('Unexpected setup roles.');
const testnet=new TestnetDemo(config);await testnet.inspect();
const provider=new JsonRpcProvider({url:TESTNET_RPC}),account=new Account(credential.account_id,provider,credential.private_key);
const submitted:object[]=[];
async function send(label:string,receiver:string,operations:Action[]){
  const file=`.local/near-demo/setup-${label}.json`;let signed:SignedTransaction;
  if(existsSync(file))signed=SignedTransaction.decode(Buffer.from(JSON.parse(readFileSync(file,'utf8')).signedBase64,'base64'));
  else {
    signed=await account.createSignedTransaction({receiverId:receiver,actions:operations});
    const hash=baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
    writeFileSync(file,JSON.stringify({network:'testnet',receiver,hash,signedBase64:Buffer.from(signed.encode()).toString('base64')},null,2)+'\n',{mode:0o600,flag:'wx'});
  }
  const r=await provider.sendTransactionUntil(signed,'FINAL');
  writeFileSync(`.local/near-demo/setup-${label}-receipt.json`,JSON.stringify(r,null,2)+'\n');
  if(r.final_execution_status!=='FINAL'||typeof r.status!=='object'||!('SuccessValue' in r.status))throw new Error('Setup outcome uncertain; inspect saved receipt before retrying.');
  submitted.push({operation:label,hash:r.transaction.hash,receiver,status:'FINAL'});
}
try{await provider.viewAccount({accountId:config.controllerId,blockQuery:{finality:'final'}});}
catch(error){
  if((error as any)?.type!=='UNKNOWN_ACCOUNT'&&!String(error).includes('does not exist'))throw error;
  await send('activate-controller',config.controllerId,[actions.transfer(500_000_000_000_000_000_000_000n)]);
}
if(!(await testnet.view(TEST_USDC,'storage_balance_of',{account_id:config.contractId})).value){
  const minimum=BigInt((await testnet.view(TEST_USDC,'storage_balance_bounds')).value.min);
  if(minimum<=0n||minimum>10n**23n)throw new Error('Unexpected token storage minimum.');
  await send('circle-storage',TEST_USDC,[actions.functionCall('storage_deposit',{account_id:config.contractId,registration_only:true},30_000_000_000_000n,minimum)]);
}
const controller=await provider.viewAccount({accountId:config.controllerId,blockQuery:{finality:'final'}});
const metadata=(await testnet.view(TEST_USDC,'ft_metadata')).value;
if(metadata.decimals!==6||metadata.symbol!=='USDC')throw new Error('Unexpected Circle test token metadata.');
const storage=(await testnet.view(TEST_USDC,'storage_balance_of',{account_id:config.contractId})).value;
const report={network:'testnet',contractId:config.contractId,controllerId:config.controllerId,controllerTestNear:controller.amount.toString(),tokenId:TEST_USDC,metadata,clearingTokenStorage:storage,submitted,observedAt:new Date().toISOString()};
writeFileSync('docs/testing/near-testnet-setup.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
