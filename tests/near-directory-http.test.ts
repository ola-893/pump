import {test} from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'node:http';import {once} from 'node:events';import {KeyPair,KeyPairSigner,PublicKey} from 'near-api-js';
import {DemoStore} from '../near-demo/store.js';import {PaperDemo} from '../near-demo/service.js';import {nearDemoApi} from '../near-demo/api.js';import {TestnetDemo} from '../near-demo/testnet.js';import {TEST_USDC} from '../near-demo/types.js';
import {PumpDirectory,publicationHash} from '../near-demo/directory/service.js';import {directoryHandler} from '../near-demo/directory/server.js';import {verifyDirectoryRecord} from '../near-demo/directory/verify.js';
import {directoryFixture as entry} from './fixtures/near-directory.js';
test('two wallet owners publish through HTTP; discovery and profile APIs replay evidence and reject cross-user writes',async()=>{
 const store=new DemoStore(':memory:'),directory=new PumpDirectory(store.db,'http://127.0.0.1:5197',async()=> 'FullAccess');
 const hub=createServer((req,res)=>void directoryHandler(directory,new Set(['http://127.0.0.1:5197']))(req,res));hub.listen(0,'127.0.0.1');await once(hub,'listening');const hubUrl='http://127.0.0.1:'+(hub.address() as any).port;
 const api=nearDemoApi({directoryKeyPermission:async()=> 'FullAccess',paper:new PaperDemo(store),vaultConfig:{network:'testnet',parentId:'fixture.testnet',vaults:[]},testnet:new TestnetDemo({network:'testnet',controllerId:'owner.testnet',reporterId:'owner.testnet',contractId:null,tokenId:TEST_USDC})});
 const app=createServer((req,res)=>void api.handle(req,res,()=>{res.writeHead(404);res.end();}));app.listen(0,'127.0.0.1');await once(app,'listening');const appUrl='http://127.0.0.1:'+(app.address() as any).port+'/api/near-demo';
 const post=async(url:string,body:any)=>{const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,data:await r.json() as any};};
 try{
  const records=[];
  for(const owner of ['alice.testnet','bob.testnet']){const wallet=KeyPair.fromRandom('ed25519'),runner=KeyPair.fromRandom('ed25519');
   const c=(await post(hubUrl+'/challenge',{account:owner,runnerKey:runner.getPublicKey().toString(),action:'grant'})).data;
   const signed=await KeyPairSigner.fromSecretKey(wallet.toString()).signNep413Message(owner,{message:c.message,nonce:Buffer.from(c.nonce,'base64'),recipient:c.recipient});
   const proof={accountId:owner,publicKey:signed.publicKey.toString(),signature:Buffer.from(signed.signature).toString('base64')};assert.equal((await post(hubUrl+'/authorize',{id:c.id,signed:proof})).status,200);
   const record=entry(owner),payload={schema:'PUMP-DIRECTORY-SNAPSHOT-v1',owner,sequence:Date.now(),at:Date.now(),entries:[record]};
   assert.equal((await post(hubUrl+'/publish',{payload,publicKey:runner.getPublicKey().toString(),signature:Buffer.from(runner.sign(publicationHash(payload)).signature).toString('base64')})).status,200);records.push(record);
  }
  const catalog=await (await fetch(hubUrl+'/catalog')).json() as any;assert.equal(catalog.total,2);assert.equal(catalog.items[0].entry.histories,undefined);
  const publicStatus=await (await fetch(appUrl+'/public-status')).json() as any;assert.equal(publicStatus.registry.agents.length,2);assert.equal(publicStatus.registry.strategyRuns[0].activity.fills,0);assert.equal(publicStatus.registry.strategyRuns[0].session.metrics.total,'0');
  const first=records[0],rid=first.runs[0].id;
  const history=await post(appUrl+'/public-strategy-history',{runId:rid});assert.equal(history.status,200,JSON.stringify(history.data));assert.deepEqual(history.data.events,[]);
  const report=await post(appUrl+'/public-strategy-report',{runId:rid});assert.equal(report.status,200);assert.equal(report.data.report.fills,0);
  const read=await (await fetch(hubUrl+'/agents/'+first.agent.id)).json() as any,env=read.signedPublication;assert.ok(PublicKey.from(env.publicKey).verify(publicationHash(env.payload),Buffer.from(env.signature,'base64')));
  assert.equal(verifyDirectoryRecord(read,'http://127.0.0.1:5197').entry.runs[0].session.metrics.total,'0');
  const tampered=structuredClone(read);tampered.signedPublication.payload.entries[0].agent.manifest.name='forged';assert.throws(()=>verifyDirectoryRecord(tampered,'http://127.0.0.1:5197'),/signature/);
  const token=(await (await fetch(appUrl+'/status')).json() as any).token;
  const bad=await fetch(appUrl+'/directory-authorize',{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':token},body:JSON.stringify({id:'f'.repeat(64),signed:{}})});const badBody=await bad.json() as any;assert.equal(bad.status,400);assert.match(badBody.error,/challenge expired/);
  const evil=await fetch(hubUrl+'/challenge',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.example'},body:'{}'});assert.equal(evil.status,403);
 }finally{api.close();app.close();hub.close();await Promise.all([once(app,'close'),once(hub,'close')]);store.close();}
});
