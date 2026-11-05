import { TESTNET_RPC } from './types.js';
// Produces review material only. Signing and public broadcast belong to the operator.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { TestnetDemo } from './testnet.js';
import type { TestnetConfig } from './types.js';

const config=JSON.parse(readFileSync(new URL('../deployments/near-demo-testnet.json',import.meta.url),'utf8')) as TestnetConfig;
const contractId=process.argv[2]??config.contractId;
if(!contractId)throw new Error('Provide the exact named testnet contract account: npm run demo:deploy-plan -- your-contract.testnet');
new TestnetDemo({...config,contractId});
const wasm=resolve('contracts-near/target/wasm32-unknown-unknown/release/pumpcoin_demo_clearing.wasm');
const bytes=readFileSync(wasm),hash=createHash('sha256').update(bytes).digest('hex');
const args={controller_id:config.controllerId,reporter_id:config.reporterId};
const quote=(s:string)=>"'"+s.replaceAll("'","'\\''")+"'";
const command=['near','contract','deploy',contractId,'use-file',wasm,'with-init-call','new','json-args',JSON.stringify(args),'prepaid-gas','50 Tgas','attached-deposit','0 NEAR','network-config','testnet','sign-with-keychain','send'].map(quote).join(' ');
const plan={network:'testnet',rpc:TESTNET_RPC,contractId,wasm,sha256:hash,bytes:bytes.length,init:args,actions:['DeployContract','FunctionCall:new'],attachedDeposit:'0',gas:'50000000000000',command,broadcast:false,notes:['The chosen contract account must already exist and hold test NEAR for storage and gas.','Deploy and initialize in one transaction. Do not deploy the sandbox fixture token.','Keep the deployment access key local. Full-access keys retain code-upgrade authority.','After a FINAL successful receipt, set contractId in deployments/near-demo-testnet.json and restart the local server.']};
mkdirSync('.local/near-demo',{recursive:true,mode:0o700});
writeFileSync('.local/near-demo/deploy-plan.json',JSON.stringify(plan,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(plan,null,2));
