// Single faucet request for the approved TESTNET vault repair. Never prints keys.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';import {randomBytes,createHash} from 'node:crypto';
import {Account,KeyPair,SignedTransaction,actions,baseEncode} from 'near-api-js';import {testnetProvider} from './rpc.js';
const dir='.local/near-demo/',replacement=process.argv.includes('--replacement-owner');
// A separate single request covers the explicitly approved replacement agents
// after the original owner became inaccessible. Never rotate identities on denial.
if(replacement){const plan=JSON.parse(readFileSync(dir+'owner-replacement-plan-20261104.json','utf8'));if(plan.network!=='testnet'||plan.approvedPurpose!=='Recover funds and prepare replacements'||plan.agents.length!==3||plan.agents.some((a:any)=>a.controller!=='rudepuma4060.testnet'))throw new Error('Unexpected replacement funding purpose.');}
const prefix=replacement?'owner-replacement-faucet':'upgrade-faucet',accountPrefix=replacement?'pump-replace-':'pump-upgrade-',keyFile=dir+prefix+'-funder.json',attempt=dir+prefix+'-attempt.json',target='pumpcoin-demo-472db8.testnet';
if(!existsSync(keyFile)){const k=KeyPair.fromRandom('ed25519');writeFileSync(keyFile,JSON.stringify({network:'testnet',account_id:accountPrefix+randomBytes(3).toString('hex')+'.testnet',public_key:k.getPublicKey().toString(),private_key:k.toString()})+'\n',{mode:0o600,flag:'wx'});}
const c=JSON.parse(readFileSync(keyFile,'utf8'));if(c.network!=='testnet'||!new RegExp('^'+accountPrefix+'[a-f0-9]{6}\\.testnet$').test(c.account_id)||KeyPair.fromString(c.private_key).getPublicKey().toString()!==c.public_key)throw new Error('Unexpected faucet funding identity.');
const p=testnetProvider();let state;
try{state=await p.viewAccount({accountId:c.account_id,blockQuery:{finality:'final'}});}catch(e){if(!/does not exist|UNKNOWN_ACCOUNT|not active/i.test(String(e))&&!(e as any)?.data?.cause?.name?.includes('UNKNOWN_ACCOUNT'))throw e;}
if(!state){
 if(existsSync(attempt))throw new Error('A faucet request was already attempted; inspect that response rather than creating another identity.');
 const request={newAccountId:c.account_id,newAccountPublicKey:c.public_key};writeFileSync(attempt,JSON.stringify({network:'testnet',request,at:new Date().toISOString()})+'\n',{mode:0o600,flag:'wx'});
 const r=await fetch('https://helper.nearprotocol.com/account',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});const response=await r.text();writeFileSync(dir+prefix+'-response.json',response,{mode:0o600});if(!r.ok)throw new Error('Faucet did not confirm funding: HTTP '+r.status+'; saved response available.');
 state=await p.viewAccount({accountId:c.account_id,blockQuery:{finality:'final'}});
}
const available=state.amount-BigInt(state.storage_usage)*10n**19n;
console.log(JSON.stringify({network:'testnet',funder:c.account_id,available:String(available),requestVerified:true}));
if(!process.argv.includes('--transfer'))process.exit(0);
const journal=dir+prefix+'-transfer.json';let signed:SignedTransaction,amount:bigint;
if(existsSync(journal)){
 const old=JSON.parse(readFileSync(journal,'utf8'));if(old.receiver!==target||old.network!=='testnet')throw new Error('Unexpected saved transfer.');
 amount=BigInt(old.amount);signed=SignedTransaction.decode(Buffer.from(old.signed,'base64'));
 const hash=baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
 if(hash!==old.hash||signed.transaction.signerId!==c.account_id||signed.transaction.receiverId!==target||amount<=0n||amount>10n*10n**24n)throw new Error('Saved faucet transfer differs.');
 if(existsSync(journal+'.receipt.json')){
  const previous=JSON.parse(readFileSync(journal+'.receipt.json','utf8'));
  if(previous.transaction?.hash!==hash||previous.final_execution_status!=='FINAL'||previous.status?.SuccessValue===undefined||previous.receipts_outcome.some((x:any)=>x.outcome.status?.Failure))throw new Error('Saved faucet receipt needs inspection.');
  console.log(JSON.stringify({network:'testnet',receiver:target,transferred:String(amount),hash,alreadyFinal:true}));process.exit(0);
 }
}else{
 amount=available>10n**23n?available-10n**23n:0n;if(amount===0n||amount>10n*10n**24n)throw new Error('Unexpected faucet transfer budget.');
 signed=await new Account(c.account_id,p,c.private_key).createSignedTransaction({receiverId:target,actions:[actions.transfer(amount)]});writeFileSync(journal,JSON.stringify({network:'testnet',receiver:target,amount:String(amount),hash:baseEncode(createHash('sha256').update(signed.transaction.encode()).digest()),signed:Buffer.from(signed.encode()).toString('base64')})+'\n',{mode:0o600,flag:'wx'});
}
const receipt=await p.sendTransactionUntil(signed,'FINAL');writeFileSync(journal+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{mode:0o600});
if(receipt.final_execution_status!=='FINAL'||typeof receipt.status!=='object'||!('SuccessValue'in receipt.status)||receipt.receipts_outcome.some(x=>typeof x.outcome.status==='object'&&'Failure'in x.outcome.status))throw new Error('Faucet transfer is not confirmed.');
console.log(JSON.stringify({network:'testnet',source:c.account_id,receiver:target,transferred:String(amount),hash:receipt.transaction.hash,final:true}));
