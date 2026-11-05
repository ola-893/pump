import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,readdirSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

async function worker(role:string,folder:string,remote='',owner=''){
 const child=fork(new URL('./fixtures/directory-process.ts',import.meta.url),[role,folder,remote,owner],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
 let nextId=0,stderr='';
 const waiting=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void}>();
 child.stderr?.on('data',chunk=>{stderr+=chunk;});
 const ready=await new Promise<any>((resolve,reject)=>{
  child.on('message',(m:any)=>{if(m.ready)resolve(m);else{const request=waiting.get(m.id);if(!request)return;waiting.delete(m.id);if(m.error)request.reject(new Error(m.error));else request.resolve(m.value);}});
  child.once('error',reject);
  child.once('exit',code=>{const error=new Error('Fixture exited '+code+' '+stderr);reject(error);for(const request of waiting.values())request.reject(error);waiting.clear();});
 });
 return {ready,child,send(action:string,data:any={}){return new Promise<any>((resolve,reject)=>{const id=++nextId;waiting.set(id,{resolve,reject});child.send({id,action,data});});},
  async close(){if(child.exitCode!==null)return;const exited=once(child,'exit');child.send({id:++nextId,action:'stop',data:{}});await exited;}};
}
test('separate operator processes publish to a persistent hub and independent reader without sharing local data',{timeout:30000},async()=>{
 const folder=mkdtempSync(join(tmpdir(),'pump-directory-process-'));
 const children:Awaited<ReturnType<typeof worker>>[]=[];
 const launch=async(role:string,name:string,url='',owner='')=>{const dir=join(folder,name);mkdirSync(dir,{recursive:true});const w=await worker(role,dir,url,owner);children.push(w);return w;};
 try{
  const hub=await launch('hub','hub'),url=hub.ready.origin;
  let alice=await launch('runner','alice',url,'alice.testnet');
  const bob=await launch('runner','bob',url,'bob.testnet'),reader=await launch('reader','reader',url);
  for(const publisher of [alice,bob]){
   const data={owner:publisher.ready.owner,key:publisher.ready.publicKey};
   await hub.send('setKey',data);await reader.send('setKey',data);await publisher.send('authorize');
  }
  const records=await reader.send('catalog');assert.equal(records.length,2);
  assert.deepEqual(await reader.send('sessions'),[]);
  assert.deepEqual(await alice.send('sessions'),[alice.ready.sessionId]);
  assert.deepEqual(await bob.send('sessions'),[bob.ready.sessionId]);
  for(const publisher of [alice,bob]){
   const read=await reader.send('read',{id:publisher.ready.agentId});
   assert.equal(read.entry.agent.manifest.controller,publisher.ready.owner);
   assert.equal(read.entry.runs[0].activity.fills,0); // forged fixture counters are recomputed
   assert.equal(read.entry.histories[read.entry.runs[0].id].session.config.endpoint,undefined);
   const dir=join(folder,publisher.ready.owner.split('.')[0],'runner-keys');
   assert.equal(readdirSync(dir).length,1);assert.equal(statSync(join(dir,readdirSync(dir)[0])).mode&0o777,0o600);
  }
  const parallel=await Promise.all([alice.send('publish'),alice.send('publish'),alice.send('publish')]);
  assert.ok(parallel[0].sequence<parallel[1].sequence&&parallel[1].sequence<parallel[2].sequence);
  const id=alice.ready.agentId;await alice.close();alice=await launch('runner','alice',url,'alice.testnet');
  assert.equal(alice.ready.agentId,id);await alice.send('publish');assert.equal((await reader.send('read',{id})).proof.owner,'alice.testnet');
  await bob.send('private');assert.equal((await reader.send('read',{id:bob.ready.agentId})).entry.agent.visibility,'public'); // Omitting a published agent cannot erase its public record.
  await alice.send('revoke');await assert.rejects(alice.send('publish'),/not authorized/);
  assert.equal((await (await fetch(url+'/catalog')).json() as any).items[0].offline,true);
  await reader.send('setKey',{owner:'alice.testnet',key:'revoked'});
  await assert.rejects(reader.send('read',{id}),/current full-access wallet key/);
 }finally{for(const child of children.reverse())await child.close();rmSync(folder,{recursive:true,force:true});}
});
