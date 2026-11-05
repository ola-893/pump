import { TESTNET_RPC } from './types.js';
// Explicit operator command. Creates only a named testnet deployment account.
// The generated private key is saved locally before requesting faucet sponsorship.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { KeyPair } from 'near-api-js';
const directory='.local/near-demo';mkdirSync(directory,{recursive:true,mode:0o700});
const keyFile=directory+'/testnet-deployer.json';
if(!existsSync(keyFile)){
  const key=KeyPair.fromRandom('ed25519');
  writeFileSync(keyFile,JSON.stringify({network:'testnet',account_id:`pumpcoin-demo-${randomBytes(3).toString('hex')}.testnet`,public_key:key.getPublicKey().toString(),private_key:key.toString()},null,2)+'\n',{mode:0o600,flag:'wx'});
}
const credential=JSON.parse(readFileSync(keyFile,'utf8'));
if(credential.network!=='testnet'||!/^pumpcoin-demo-[a-f0-9]{6}\.testnet$/.test(credential.account_id)||KeyPair.fromString(credential.private_key).getPublicKey().toString()!==credential.public_key)throw new Error('Unexpected deployment credential.');
const publicData={network:'testnet',accountId:credential.account_id,publicKey:credential.public_key,keyFile,helper:'https://helper.nearprotocol.com/account'};
const rpc=async(params:object)=>{
  const r=await fetch(TESTNET_RPC,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'pumpcoin-create-account',method:'query',params}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('Testnet RPC unavailable');return await r.json() as any;
};
let state=await rpc({request_type:'view_account',account_id:credential.account_id,finality:'final'});
if(state.error?.cause?.name==='UNKNOWN_ACCOUNT'){
  const attempt=directory+'/account-creation-attempt.json';
  if(existsSync(attempt))throw new Error('A sponsorship request was already attempted. Inspect its saved response and account status before retrying.');
  const request={newAccountId:credential.account_id,newAccountPublicKey:credential.public_key};
  writeFileSync(attempt,JSON.stringify({...publicData,request,at:new Date().toISOString()},null,2)+'\n');
  const response=await fetch(publicData.helper,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(45000)});
  const raw=await response.text();writeFileSync(directory+'/account-creation-response.json',raw);
  if(!response.ok)throw new Error(`Official testnet faucet returned HTTP ${response.status}. No account creation is claimed; inspect the saved response.`);
  state=await rpc({request_type:'view_account',account_id:credential.account_id,finality:'final'});
}
if(state.error)throw new Error('Testnet account creation is not yet confirmed.');
const access=await rpc({request_type:'view_access_key',account_id:credential.account_id,public_key:credential.public_key,finality:'final'});
if(access.error||access.result?.permission!=='FullAccess')throw new Error('The generated key does not control the observed account.');
const receipt={...publicData,account:state.result,accessKeyConfirmed:true,createdAt:new Date().toISOString()};
writeFileSync(directory+'/testnet-account.json',JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
