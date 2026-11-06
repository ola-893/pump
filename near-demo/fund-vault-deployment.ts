import { TESTNET_RPC } from './types.js';
// Obtain only faucet test NEAR needed for the reviewed vault storage plan.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {Account,JsonRpcProvider,KeyPair,SignedTransaction,actions,baseEncode} from 'near-api-js';
const seed=process.argv.includes('--seed');
const dir='.local/near-demo/',plan=JSON.parse(readFileSync(dir+(seed?'seed-factory-install.plan.json':'agent-vaults/plan.json'),'utf8'));
const maximum=BigInt(seed?plan.factoryAccountFunding:plan.maximumTotalFunding);
if(seed&&(plan.factory.id!=='ps.'+plan.parentId||maximum>8n*10n**24n))throw new Error('Unexpected seed factory storage plan.');
const file=(name:string)=>dir+(seed?'seed-':'')+name;
if(plan.network!=='testnet'||plan.parentId!=='pumpcoin-demo-472db8.testnet'||maximum>15n*10n**24n)throw new Error('Unexpected reviewed testnet storage plan.');
const provider=new JsonRpcProvider({url:TESTNET_RPC}),parent=await provider.viewAccount({accountId:plan.parentId,blockQuery:{finality:'final'}}),spendable=parent.amount-BigInt(parent.storage_usage)*10n**19n;
const needed=maximum+2n*10n**23n-spendable;
if(needed<=0n){console.log('Reviewed testnet deployment is already funded.');process.exit(0);}if(needed>65n*10n**23n)throw new Error('Required faucet top-up exceeds 6.5 test NEAR; request an explicit budget review.');
const keyFile=file('vault-faucet-funder.json');if(!existsSync(keyFile)){const key=KeyPair.fromRandom('ed25519');writeFileSync(keyFile,JSON.stringify({network:'testnet',account_id:'pump-vault-gas-'+randomBytes(3).toString('hex')+'.testnet',public_key:key.getPublicKey().toString(),private_key:key.toString()})+'\n',{mode:0o600,flag:'wx'});}
const c=JSON.parse(readFileSync(keyFile,'utf8'));if(c.network!=='testnet'||!/^pump-vault-gas-[a-f0-9]{6}\.testnet$/.test(c.account_id)||KeyPair.fromString(c.private_key).getPublicKey().toString()!==c.public_key)throw new Error('Unexpected faucet funding identity.');
let state;try{state=await provider.viewAccount({accountId:c.account_id,blockQuery:{finality:'final'}});}catch(e){if(!/does not exist|UNKNOWN_ACCOUNT/i.test(String(e)))throw e;}
if(!state){const attempt=file('vault-faucet-attempt.json');if(existsSync(attempt))throw new Error('A faucet request was already attempted. Inspect its response; do not create a duplicate account.');const request={newAccountId:c.account_id,newAccountPublicKey:c.public_key};writeFileSync(attempt,JSON.stringify({network:'testnet',request,at:new Date().toISOString()}));const r=await fetch('https://helper.nearprotocol.com/account',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});const text=await r.text();writeFileSync(file('vault-faucet-response.json'),text);if(!r.ok)throw new Error('Official faucet did not confirm account funding; inspect the saved response.');state=await provider.viewAccount({accountId:c.account_id,blockQuery:{finality:'final'}});}
if(state.amount<needed+10n**23n)throw new Error('Faucet account lacks the reviewed top-up amount.');
const journal=file('vault-gas-transfer.json');let signed:SignedTransaction;
if(existsSync(journal)){const j=JSON.parse(readFileSync(journal,'utf8'));if(j.receiver!==plan.parentId||j.network!=='testnet')throw new Error('Unexpected journaled transfer.');signed=SignedTransaction.decode(Buffer.from(j.signedBase64,'base64'));}
else{signed=await new Account(c.account_id,provider,c.private_key).createSignedTransaction({receiverId:plan.parentId,actions:[actions.transfer(needed)]});writeFileSync(journal,JSON.stringify({network:'testnet',receiver:plan.parentId,amount:String(needed),hash:baseEncode(createHash('sha256').update(signed.transaction.encode()).digest()),signedBase64:Buffer.from(signed.encode()).toString('base64')})+'\n',{mode:0o600,flag:'wx'});}
const receipt=await provider.sendTransactionUntil(signed,'FINAL');writeFileSync(file('vault-gas-transfer-receipt.json'),JSON.stringify(receipt,null,2)+'\n');if(receipt.final_execution_status!=='FINAL'||typeof receipt.status!=='object'||!('SuccessValue'in receipt.status))throw new Error('Testnet gas transfer is not confirmed; inspect the saved transaction.');console.log(JSON.stringify({network:'testnet',source:'Official testnet faucet',funder:c.account_id,parentId:plan.parentId,transferredTestNear:String(Number(needed)/1e24),hash:receipt.transaction.hash,status:'FINAL'},null,2));
