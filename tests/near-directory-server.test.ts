import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {DemoStore} from '../near-demo/store.js';
import {PumpDirectory} from '../near-demo/directory/service.js';
import {directoryHandler} from '../near-demo/directory/server.js';

test('public directory limits write bursts and never serves local control routes',async()=>{
 const store=new DemoStore(':memory:');let now=Date.now();
 const directory=new PumpDirectory(store.db,'http://127.0.0.1:5198',async()=> 'FullAccess');
 const handler=directoryHandler(directory,new Set(),{now:()=>now});
 const server=createServer((req,res)=>void handler(req,res));server.listen(0,'127.0.0.1');await once(server,'listening');
 const root='http://127.0.0.1:'+(server.address() as any).port;
 try{
  assert.deepEqual(await (await fetch(root+'/health')).json(),{schema:'PUMP-PUBLIC-DIRECTORY-v1',network:'testnet',ok:true});
  assert.equal((await fetch(root+'/api/near-demo/status')).status,404);
  assert.equal((await fetch(root+'/api/local-inference/models')).status,404);
  for(let i=0;i<30;i++)assert.equal((await fetch(root+'/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
  const limited=await fetch(root+'/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'60');
  now+=60000;
  assert.equal((await fetch(root+'/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
 }finally{server.close();await once(server,'close');store.close();}
});
