// One bounded maintenance transfer; the owner still signs/pays each deployment.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createConnection} from 'node:net';import {createHash} from 'node:crypto';
import {Account,KeyPair,SignedTransaction,actions,baseEncode} from 'near-api-js';
import {testnetProvider} from './rpc.js';
import {DemoStore} from './store.js';import {PaperDemo} from './service.js';import {NearAgents} from './agents.js';import {AgentVaults} from './agent-vaults.js';import {TestnetDemo} from './testnet.js';import {LiveVaultNav} from './live-vault-nav.js';
const parent='pumpcoin-demo-472db8.testnet',owner='rudepuma4060.testnet',dir='.local/near-demo/',bufferOnly=process.argv.includes('--gas-buffer'),journal=dir+(bufferOnly?'owner-replacement-gas-buffer':'owner-replacement-funding')+'-20261104.json';
const plan=JSON.parse(readFileSync(dir+'owner-replacement-plan-20261104.json','utf8'));
if(plan.network!=='testnet'||plan.approvedPurpose!=='Recover funds and prepare replacements'||plan.agents.length!==3||plan.agents.some((a:any)=>a.controller!==owner||!a.replacementAgentId))throw new Error('Unexpected replacement approval.');
const c=JSON.parse(readFileSync(dir+'testnet-deployer.json','utf8'));if(c.network!=='testnet'||c.account_id!==parent||KeyPair.fromString(c.private_key).getPublicKey().toString()!==c.public_key)throw new Error('Unexpected funding identity.');
const provider=testnetProvider(),store=new DemoStore(dir+'paper.sqlite'),paper=new PaperDemo(store),agents=new NearAgents(paper),vaults=new AgentVaults(agents,new TestnetDemo(JSON.parse(readFileSync('deployments/near-demo-testnet.json','utf8'))));
try{
 for(const a of plan.agents)if(agents.read(a.replacementAgentId).manifest.controller!==owner)throw new Error('Replacement owner mismatch.');
 const funding=BigInt(vaults.config().factory!.funding);if(funding!==4362350000000000000000000n)throw new Error('Deployment funding changed.');
 const deployments=bufferOnly?plan.agents.filter((a:any)=>!vaults.config().vaults.some(v=>v.agentId===a.replacementAgentId)).length:3;
 const needed=BigInt(deployments)*funding+(bufferOnly?500000000000000000000000n:250000000000000000000000n),account=await provider.viewAccount({accountId:owner,blockQuery:{finality:'final'}}),available=account.amount-BigInt(account.storage_usage)*10n**19n;
 const amount=needed>available?needed-available:0n;
 if(amount>13500000000000000000000000n)throw new Error('Replacement top-up exceeds the bounded budget.');
 console.log(JSON.stringify({network:'testnet',owner,deployments,available:String(available),needed:String(needed),topUp:String(amount)}));
 if(process.argv.includes('--broadcast')){
  if(existsSync(journal+'.receipt.json')){const r=JSON.parse(readFileSync(journal+'.receipt.json','utf8'));if(r.final_execution_status!=='FINAL'||r.status?.SuccessValue===undefined||r.receipts_outcome.some((x:any)=>x.outcome.status?.Failure))throw new Error('Saved funding receipt needs inspection.');console.log(JSON.stringify({alreadyFinal:true,hash:r.transaction.hash}));}
  else{
   const running=await new Promise<boolean>(resolve=>{const s=createConnection({host:'127.0.0.1',port:5197});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});if(running)throw new Error('Stop the local API before using its reporter signer.');
   const nav=new LiveVaultNav(vaults,{autoStart:false});try{for(const r of store.db.prepare("SELECT DISTINCT json_extract(body,'$.args.run_id') AS runId FROM near_nav_reports WHERE receipt IS NULL").all())await nav.sync(String(r.runId));}finally{nav.close();}
   let signed:SignedTransaction;
   if(existsSync(journal)){const saved=JSON.parse(readFileSync(journal,'utf8'));if(saved.network!=='testnet'||saved.receiver!==owner||BigInt(saved.amount)>13500000000000000000000000n)throw new Error('Unexpected saved funding.');signed=SignedTransaction.decode(Buffer.from(saved.signed,'base64'));}
   else{
    if(amount===0n)throw new Error('No funding needed.');const balance=await provider.viewAccount({accountId:parent,blockQuery:{finality:'final'}});if(balance.amount-BigInt(balance.storage_usage)*10n**19n<amount+500000000000000000000000n)throw new Error('Reporter reserve would be exhausted.');
    signed=await new Account(parent,provider,c.private_key).createSignedTransaction({receiverId:owner,actions:[actions.transfer(amount)]});writeFileSync(journal,JSON.stringify({network:'testnet',receiver:owner,amount:String(amount),hash:baseEncode(createHash('sha256').update(signed.transaction.encode()).digest()),signed:Buffer.from(signed.encode()).toString('base64')},null,2)+'\n',{mode:0o600,flag:'wx'});
   }
   const receipt=await provider.sendTransactionUntil(signed,'FINAL');writeFileSync(journal+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});if(receipt.final_execution_status!=='FINAL'||typeof receipt.status!=='object'||!('SuccessValue'in receipt.status)||receipt.receipts_outcome.some(x=>typeof x.outcome.status==='object'&&'Failure'in x.outcome.status))throw new Error('Funding not confirmed.');console.log(JSON.stringify({final:true,hash:receipt.transaction.hash}));
  }
 }
}finally{paper.close();await agents.close();store.close();}
