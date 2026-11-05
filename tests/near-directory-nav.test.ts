import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {KeyPair,KeyPairSigner} from 'near-api-js';
import {DemoStore} from '../near-demo/store.js';
import {PaperDemo} from '../near-demo/service.js';
import {TestnetDemo} from '../near-demo/testnet.js';
import {AgentVaults,ownedVaultAccount,type VaultConfig} from '../near-demo/agent-vaults.js';
import {TEST_USDC} from '../near-demo/types.js';
import {PumpDirectory,publicationHash} from '../near-demo/directory/service.js';
import {directoryHandler} from '../near-demo/directory/server.js';
import {DirectoryRunner} from '../near-demo/directory/runner.js';
import {DirectoryNavSource} from '../near-demo/directory/nav-source.js';
import {directoryFixture} from './fixtures/near-directory.js';

async function setup(){
 const hubStore=new DemoStore(':memory:'),localStore=new DemoStore(':memory:');let now=Date.now(),offline=false,forgedTime=false,forgedSummary=false;
 let directory:PumpDirectory;
 const server=createServer((req,res)=>{if(offline){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture outage'}));return;}
  if(forgedSummary&&req.url?.startsWith('/catalog')){const catalog=directory.catalog();for(const item of catalog.items){item.entry.agent.manifest.name='Forged summary';item.entry.runs[0].activity.fills=1000000;}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(catalog));return;}
  if(forgedTime&&req.url?.startsWith('/agents/')){const record=directory.read(req.url.slice('/agents/'.length));record.proof.reportedAt=now;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(record));return;}
  void directoryHandler(directory,new Set())(req,res);
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const url='http://127.0.0.1:'+(server.address() as any).port;
 directory=new PumpDirectory(hubStore.db,url,async()=> 'FullAccess',()=>now);
 const localRuns:any[]=[],localRecords:any[]=[];
 const paper=new PaperDemo(localStore),agents:any={paper,records:()=>localRecords,strategies:{records:()=>localRuns,read:(id:string)=>{const r=localRuns.find(r=>r.id===id);if(!r)throw new Error('Local strategy unavailable');return r;},export:()=>{throw new Error('Local strategy unavailable');}}};
 const config:VaultConfig={network:'testnet',parentId:'reporter.testnet',vaults:[],factory:{id:'factory.testnet',codeHash:'factory-code',vaultCodeHash:'vault-code',funding:'1',reporterId:'reporter.testnet',liveNav:true}};
 const testnet=new TestnetDemo({network:'testnet',controllerId:'operator.testnet',reporterId:'reporter.testnet',contractId:null,tokenId:TEST_USDC});
 const readerKeys=new Map<string,string>();
 const readerDirectory=new PumpDirectory(localStore.db,url,async(owner,key)=>readerKeys.get(owner)===key?'FullAccess':'UnknownKey');
 const vaults=new AgentVaults(agents,testnet,config),reader=new DirectoryRunner(agents,vaults,readerDirectory,url),source=new DirectoryNavSource(vaults,reader,{autoStart:false,now:()=>now});
 const runnerKeys=new Map<string,KeyPair>();
 async function publish(owner:string){
  const wallet=KeyPair.fromRandom('ed25519'),runner=KeyPair.fromRandom('ed25519');runnerKeys.set(owner,runner);readerKeys.set(owner,wallet.getPublicKey().toString());
  const challenge=directory.auth.challenge(owner,runner.getPublicKey().toString(),'grant');
  const signed=await KeyPairSigner.fromSecretKey(wallet.toString()).signNep413Message(owner,{message:challenge.message,nonce:Buffer.from(challenge.nonce,'base64'),recipient:challenge.recipient});
  await directory.authorize(challenge.id,{accountId:owner,publicKey:signed.publicKey.toString(),signature:Buffer.from(signed.signature).toString('base64')});
  const entry:any=directoryFixture(owner),run=entry.runs[0];
  entry.vaults=[{agentId:entry.agent.id,runId:run.id,strategyHash:run.commitment,manifestHash:entry.agent.commitment,ownerId:owner,factoryId:config.factory!.id,contractId:ownedVaultAccount(run.id,owner,config.factory!.id),codeHash:'vault-code',reporterId:'reporter.testnet',liveNav:true}];
  send(entry);return entry;
 }
 function send(entry:any,sequence=1){const owner=entry.agent.manifest.controller,runner=runnerKeys.get(owner)!;const payload={schema:'PUMP-DIRECTORY-SNAPSHOT-v1',owner,at:now,sequence,entries:[entry]};return directory.publish(payload,runner.getPublicKey().toString(),Buffer.from(runner.sign(publicationHash(payload)).signature).toString('base64'));}
 async function close(){source.close();reader.close();paper.close();server.close();await once(server,'close');localStore.close();hubStore.close();}
 return {source,reader,directory,localStore,localRuns,localRecords,publish,send,config,readerUrl:url,runnerKeys,readerKeys,close,setNow:(t:number)=>now=t,getNow:()=>now,setOffline:()=>offline=true,forgeTime:()=>forgedTime=true,forgeSummary:()=>forgedSummary=true};
}
test('central reporter reads two owner-signed remote checkpoints without importing sessions or keys',async()=>{
 const f=await setup();try{
  const alice=await f.publish('alice.testnet'),bob=await f.publish('bob.testnet');await f.source.refresh();
  assert.equal(f.source.facade.list().length,2);assert.equal(f.localStore.list().length,0);
  for(const entry of [alice,bob]){const run=entry.runs[0],agents=f.source.facade.agents;
   assert.equal(agents.strategies.read(run.id).agentId,entry.agent.id);
   assert.equal(agents.paper.store.read(run.sessionId).agent!.id,entry.agent.id);
   const bundle=agents.strategies.export(run.id);assert.equal(bundle.paper.replay.head,entry.histories[run.id].session.head);assert.equal((bundle as any).originProof.owner,entry.agent.manifest.controller);
   assert.equal(f.source.facade.list().find(v=>v.runId===run.id)!.contractId,entry.vaults[0].contractId);
  }
  f.setNow(f.getNow()+45001);assert.deepEqual(f.source.facade.list(),[]);
  assert.throws(()=>f.source.facade.agents.strategies.read(alice.runs[0].id),/unavailable/);
  assert.throws(()=>f.source.facade.agents.paper.store.read(alice.runs[0].sessionId),/not found/);
 }finally{await f.close();}
});
test('an unavailable runner or forged checkpoint timestamp cannot keep remote NAV reporting eligible',async()=>{
 const f=await setup();try{await f.publish('alice.testnet');await f.source.refresh();assert.equal(f.source.facade.list().length,1);
  f.setNow(f.getNow()+1000);f.forgeTime();await f.source.refresh();assert.deepEqual(f.source.facade.list(),[]);
  f.setOffline();await f.source.refresh();assert.deepEqual(f.source.facade.list(),[]);
 }finally{await f.close();}
});
test('remote strategies cannot shadow private local strategy or session IDs',async()=>{
 const f=await setup();try{const alice=await f.publish('alice.testnet'),bob=await f.publish('bob.testnet');
  f.localRuns.push({...alice.runs[0],agentId:'private-local-agent'});
  f.localStore.create({...bob.histories[bob.runs[0].id].session,agent:{id:'private-local-agent',modelId:'private',weightsHash:'private'}} as any);
  await f.source.refresh();assert.deepEqual(f.source.facade.list(),[]);
  assert.equal(f.source.facade.agents.strategies.read(alice.runs[0].id).agentId,'private-local-agent');
  assert.equal(f.source.facade.agents.paper.store.read(bob.runs[0].sessionId).agent!.id,'private-local-agent');
 }finally{await f.close();}
});
test('directory permanently reserves strategy/session bindings across owners and rejected writes are atomic',async()=>{
 const f=await setup();try{const alice=await f.publish('alice.testnet'),bob=await f.publish('bob.testnet'),run=bob.runs[0];
  const change=(kind:'run'|'session')=>{const e=structuredClone(bob),r=e.runs[0],h=e.histories[r.id];
   if(kind==='run'){delete e.histories[r.id];r.id=alice.runs[0].id;r.session.agent.strategyRunId=r.id;h.session.agent.strategyRunId=r.id;e.histories[r.id]=h;e.vaults[0].runId=r.id;}
   else {r.sessionId=alice.runs[0].sessionId;r.session.id=r.sessionId;h.session.id=r.sessionId;}
   return e;};
  assert.throws(()=>f.send(change('run'),2),/another published record/);
  assert.throws(()=>f.send(change('session'),2),/another published record/);
  assert.equal(f.directory.read(bob.agent.id).entry.runs[0].id,run.id);
  assert.equal(f.directory.catalog().total,2);
  assert.equal(f.send(bob,2).accepted,1);
  new PumpDirectory(f.directory.db,f.directory.auth.origin,async()=> 'FullAccess',f.getNow); // migration preserves existing reservations
  assert.throws(()=>f.send(change('session'),3),/another published record/);
 }finally{await f.close();}
});

test('operator runner sends the journal checkpoint even when the dashboard hides equity',async()=>{
 const f=await setup(),operatorStore=new DemoStore(':memory:');let publisher:DirectoryRunner|undefined;
 try{
  const entry=await f.publish('alice.testnet'),run=entry.runs[0],history=entry.histories[run.id];
  operatorStore.create({...history.session,config:{...history.session.config,endpoint:'http://127.0.0.1:9999/v1'}});
  const presentation=structuredClone(run);presentation.session.portfolio.equity=null;
  const publicRegistry={agents:[entry.agent],strategyRuns:[presentation]};
  const operator={strategies:{read:()=>entry.runs[0].definition},paper:new PaperDemo(operatorStore),publicStatus:()=>publicRegistry,records:()=>[entry.agent],visibility:()=> 'public'};
  publisher=new DirectoryRunner(operator as any,{list:()=>entry.vaults} as any,f.directory,f.readerUrl);
  Object.defineProperty(publisher,'key',{value:()=>f.runnerKeys.get('alice.testnet')});
  const result=await publisher.publish('alice.testnet');assert.equal(result.accepted,1);
  const published=await f.reader.read(entry.agent.id);
  assert.equal(published.entry.runs[0].session.portfolio.equity,history.session.portfolio.equity);
  assert.equal(published.entry.histories[run.id].session.config.endpoint,undefined);
  assert.equal(presentation.session.portfolio.equity,null);
 }finally{publisher?.close();operatorStore.close();await f.close();}
});


test('remote ownership fails closed when the independently checked NEAR key differs',async()=>{
 const f=await setup();
 try{
  const alice=await f.publish('alice.testnet');
  await f.reader.read(alice.agent.id);
  f.readerKeys.delete('alice.testnet');
  await assert.rejects(f.reader.read(alice.agent.id),/current full-access wallet key/);
  await f.source.refresh();
  assert.deepEqual(f.source.facade.list(),[]);
 }finally{await f.close();}
});

test('remote catalog reconstructs names and performance from signed records instead of trusting summaries',async()=>{
 const f=await setup();try{
  const alice=await f.publish('alice.testnet');f.forgeSummary();
  const records=await f.reader.catalog();
  assert.equal(records[0].entry.agent.manifest.name,alice.agent.manifest.name);
  assert.equal(records[0].entry.runs[0].activity.fills,0);
 }finally{await f.close();}
});


test('saved runner permissions do not follow a different directory origin or an unscoped legacy grant',async()=>{
 const f=await setup();let restored:DirectoryRunner|undefined,moved:DirectoryRunner|undefined;
 try{
  f.localStore.db.prepare('INSERT INTO near_directory_links(owner,enabled,origin) VALUES(?,?,?)').run('alice.testnet',1,f.readerUrl);
  f.localStore.db.prepare('INSERT INTO near_directory_links(owner,enabled,origin) VALUES(?,?,?)').run('legacy.testnet',1,'');
  restored=new DirectoryRunner({paper:{store:f.localStore}} as any,{list:()=>[]} as any,f.directory,f.readerUrl);
  assert.deepEqual(restored.status().enabledOwners,['alice.testnet']);
  moved=new DirectoryRunner({paper:{store:f.localStore}} as any,{list:()=>[]} as any,f.directory,'https://changed.example');
  assert.deepEqual(moved.status().enabledOwners,[]);
 }finally{restored?.close();moved?.close();await f.close();}
});
