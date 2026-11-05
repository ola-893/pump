import {randomBytes} from 'node:crypto';
import {publicKeyBytes,verifySignature,nep413Hash} from './signatures.js';
export {nep413Hash} from './signatures.js';
import type {DatabaseSync} from 'node:sqlite';
import {canonical,digest} from '../ledger.js';
import {testAccount} from '../types.js';
import {testnetReads} from '../rpc.js';
export class DirectoryAuth{
 private db:DatabaseSync;readonly origin:string;private keyPermission:(account:string,key:string)=>Promise<string>;private now:()=>number;
 constructor(db:DatabaseSync,origin:string,keyPermission:((account:string,key:string)=>Promise<string>)=async(account,key)=>{
  const r=await testnetReads().query('query',{request_type:'view_access_key',finality:'final',account_id:account,public_key:key});return r.permission;
 },now=Date.now){this.db=db;this.origin=origin;this.keyPermission=keyPermission;this.now=now;db.exec('CREATE TABLE IF NOT EXISTS directory_challenges(id TEXT PRIMARY KEY,body TEXT NOT NULL,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0)');}
 challenge(account:string,runnerKey:string,action:'grant'|'revoke'){
  testAccount(account);if(!['grant','revoke'].includes(action)||!runnerKey.startsWith('ed25519:'))throw new Error('Invalid runner authorization.');publicKeyBytes(runnerKey);
  this.db.prepare('DELETE FROM directory_challenges WHERE expires<?').run(this.now());
  if(Number(this.db.prepare('SELECT count(*) n FROM directory_challenges').get()!.n)>=1000)throw new Error('Too many pending sign-in requests. Try again later.');
  const id=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('base64'),expires=this.now()+120000;
  const recipient='pump-directory:'+new URL(this.origin).host;
  const message=canonical({purpose:action==='grant'?'Authorize this local runner to publish my PUBLIC Pump agents and strategy evidence. No trading or token authority.':'Revoke this runner’s public-directory publishing permission.',account,runnerKey,action,network:'testnet',origin:this.origin,challenge:id,expires});
  const body={id,account,runnerKey,action,message,nonce,recipient,expires,origin:this.origin};this.db.prepare('INSERT INTO directory_challenges(id,body,expires) VALUES(?,?,?)').run(id,canonical(body),expires);return body;
 }
 async assertCurrentOwnerKey(account:string,publicKey:string){
  testAccount(account);
  if(await this.keyPermission(account,publicKey)!=='FullAccess')
   throw new Error('Sign with a current full-access wallet key.');
 }
 async verify(id:string,signed:{accountId:string;publicKey:string;signature:string}){
  const row=this.db.prepare('SELECT body,expires,used FROM directory_challenges WHERE id=?').get(id) as {body:string;expires:number;used:number}|undefined;
  if(!row||row.used||row.expires<this.now())throw new Error('Sign-in challenge expired or was already used.');
  const c=JSON.parse(row.body);if(signed.accountId!==c.account)throw new Error('Wallet account differs from this challenge.');
  if(typeof signed.signature!=='string'||typeof signed.publicKey!=='string')throw new Error('Invalid wallet signature format.');
  const sig=Buffer.from(signed.signature,'base64');if(sig.length!==64||!verifySignature(signed.publicKey,nep413Hash(c.message,c.nonce,c.recipient),sig))throw new Error('Invalid wallet ownership signature.');
  await this.assertCurrentOwnerKey(c.account,signed.publicKey);
  if(this.db.prepare('UPDATE directory_challenges SET used=1 WHERE id=? AND used=0 AND expires>=?').run(id,this.now()).changes!==1)throw new Error('Sign-in challenge was already used.');
  const proof={challenge:c,signed:{accountId:signed.accountId,publicKey:signed.publicKey.toString(),signature:signed.signature}};return {...c,proof,proofHash:digest(proof)};
 }
}
