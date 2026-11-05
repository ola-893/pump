// Bounded, one-time TESTNET maintenance funding. Stop the local API first so its
// reporter and this utility cannot sign different transactions with one nonce.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createConnection} from 'node:net';
import {Account,SignedTransaction,actions,baseEncode,KeyPair} from 'near-api-js';
import {testnetProvider} from './rpc.js';
import {DemoStore} from './store.js';import {PaperDemo} from './service.js';import {NearAgents} from './agents.js';import {AgentVaults} from './agent-vaults.js';import {TestnetDemo} from './testnet.js';import {LiveVaultNav} from './live-vault-nav.js';
const plan=JSON.parse(readFileSync('.local/near-demo/vault-upgrade-funding-20261104.json','utf8'));
const credential=JSON.parse(readFileSync('.local/near-demo/testnet-deployer.json','utf8'));
const provider=testnetProvider(),broadcast=process.argv.includes('--broadcast');
if(plan.network!=='testnet'||plan.parentId!=='pumpcoin-demo-472db8.testnet'||credential.network!=='testnet'||credential.account_id!==plan.parentId||KeyPair.fromString(credential.private_key).getPublicKey().toString()!==credential.public_key)throw new Error('Unexpected demo funding identity.');
const total=plan.owners.reduce((n:bigint,o:any)=>n+BigInt(o.shortfall),0n);
if(total>25n*10n**24n||plan.totalVaults!==5||plan.retainForReporter!=='500000000000000000000000')throw new Error('Funding differs from the bounded five-vault repair plan.');
const store=new DemoStore('.local/near-demo/paper.sqlite'),paper=new PaperDemo(store),agents=new NearAgents(paper);
try{
 for(const owner of plan.owners)if(!agents.records().some(a=>a.manifest.controller===owner.owner))throw new Error('Funding owner is not a registered agent controller.');
 if(!broadcast){console.log(JSON.stringify({network:'testnet',parent:plan.parentId,maximumTotal:total.toString(),owners:plan.owners.map((o:any)=>({account:o.owner,amount:o.shortfall})),retainForReporter:plan.retainForReporter},null,2));}
 else{
  const running=await new Promise<boolean>(resolve=>{const socket=createConnection({host:'127.0.0.1',port:5197});socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});
  if(running)throw new Error('Stop the local API before maintenance funding to serialize its reporter signer.');
  const vaults=new AgentVaults(agents,new TestnetDemo(JSON.parse(readFileSync('deployments/near-demo-testnet.json','utf8')))),nav=new LiveVaultNav(vaults,{autoStart:false});
  try{const pending=store.db.prepare("SELECT DISTINCT json_extract(body,'$.args.run_id') AS runId FROM near_nav_reports WHERE receipt IS NULL").all();for(const row of pending)await nav.sync(String(row.runId));}finally{nav.close();}
  const signer=new Account(plan.parentId,provider,credential.private_key);
  for(const owner of plan.owners){
   const amount=BigInt(owner.shortfall);if(amount===0n)continue;
   const journal='.local/near-demo/vault-upgrade-funding-'+owner.owner+'-20261104.json';
   if(existsSync(journal+'.receipt.json')){const receipt=JSON.parse(readFileSync(journal+'.receipt.json','utf8'));if(receipt.final_execution_status==='FINAL'&&receipt.status?.SuccessValue!==undefined){console.log(JSON.stringify({account:owner.owner,alreadyFinal:true,hash:receipt.transaction.hash}));continue;}throw new Error('Existing funding receipt needs inspection.');}
   const parent=await provider.viewAccount({accountId:plan.parentId,blockQuery:{finality:'final'}});
   if(parent.amount-BigInt(parent.storage_usage)*10n**19n<amount+BigInt(plan.retainForReporter))throw new Error('Deployer needs additional test NEAR before this owner top-up.');
   let signed:SignedTransaction;
   if(existsSync(journal)){const saved=JSON.parse(readFileSync(journal,'utf8'));if(saved.network!=='testnet'||saved.receiver!==owner.owner||saved.amount!==String(amount))throw new Error('Signed funding plan differs.');signed=SignedTransaction.decode(Buffer.from(saved.signed,'base64'));}
   else{signed=await signer.createSignedTransaction({receiverId:owner.owner,actions:[actions.transfer(amount)]});writeFileSync(journal,JSON.stringify({network:'testnet',receiver:owner.owner,amount:String(amount),hash:baseEncode(createHash('sha256').update(signed.transaction.encode()).digest()),signed:Buffer.from(signed.encode()).toString('base64')},null,2)+'\n',{mode:0o600,flag:'wx'});}
   const receipt=await provider.sendTransactionUntil(signed,'FINAL');writeFileSync(journal+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
   if(receipt.final_execution_status!=='FINAL'||typeof receipt.status!=='object'||!('SuccessValue'in receipt.status)||receipt.receipts_outcome.some(x=>typeof x.outcome.status==='object'&&'Failure'in x.outcome.status))throw new Error('Funding was not confirmed. Inspect the saved transaction before retrying.');
   console.log(JSON.stringify({account:owner.owner,amount:String(amount),hash:receipt.transaction.hash,final:true}));
  }
 }
}finally{paper.close();await agents.close();store.close();}
