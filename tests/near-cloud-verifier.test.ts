import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {KeyPair,KeyPairSigner} from 'near-api-js';
import worker from '../staging/verifier/entry.js';
import {PumpDirectory,publicationHash} from '../near-demo/directory/service.js';
import {directoryFixture} from './fixtures/near-directory.js';

const origin='https://explorer-plasma-lone-macro.trycloudflare.com';
async function checkpoint(){
 const db=new DatabaseSync(':memory:'),directory=new PumpDirectory(db,origin,async()=> 'FullAccess');
 try{
  const owner='alice.testnet',wallet=KeyPair.fromRandom('ed25519'),runner=KeyPair.fromRandom('ed25519');
  const c=directory.auth.challenge(owner,runner.getPublicKey().toString(),'grant');
  const signed=await KeyPairSigner.fromSecretKey(wallet.toString()).signNep413Message(owner,{message:c.message,nonce:Buffer.from(c.nonce,'base64'),recipient:c.recipient});
  await directory.authorize(c.id,{accountId:owner,publicKey:signed.publicKey.toString(),signature:Buffer.from(signed.signature).toString('base64')});
  const entry=directoryFixture(owner),payload={schema:'PUMP-DIRECTORY-SNAPSHOT-v1',owner,at:Date.now(),sequence:1,entries:[entry]};
  directory.publish(payload,runner.getPublicKey().toString(),Buffer.from(runner.sign(publicationHash(payload)).signature).toString('base64'));
  return directory.read(entry.agent.id);
 }finally{db.close();}
}
test('cloud checkpoint verifier independently checks owner key and reports transport and historical age',async()=>{
 const record=await checkpoint(),previous=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,options)=>{assert.equal(String(input),'https://test.rpc.fastnear.com');assert.equal(JSON.parse(String(options?.body)).params.account_id,'alice.testnet');calls++;return new Response(JSON.stringify({result:{permission:'FullAccess',block_height:123}}));};
 try{
  const response=await worker.fetch(new Request('https://verifier.example/verify-checkpoint?agent='+record.entry.agent.id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(record)}));
  const result:any=await response.json();assert.equal(response.status,200);assert.equal(result.valid,true);assert.equal(result.transport,'submitted-public-checkpoint');assert.equal(result.owner,'alice.testnet');assert.equal(result.strategies[0].definitionCommitment,'verified');assert.ok(result.checkpointAgeMs>=0);assert.equal(calls,1);
  const forged=structuredClone(record);forged.signedPublication.payload.entries[0].agent.manifest.name='Forged';
  const failure=await worker.fetch(new Request('https://verifier.example/verify-checkpoint?agent='+record.entry.agent.id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(forged)}));assert.equal(failure.status,400);assert.equal(calls,1);
  globalThis.fetch=async()=>new Response(JSON.stringify({result:{permission:'FunctionCall'}}));
  const denied=await worker.fetch(new Request('https://verifier.example/verify-checkpoint?agent='+record.entry.agent.id,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(record)}));assert.equal(denied.status,400);
 }finally{globalThis.fetch=previous;}
});
