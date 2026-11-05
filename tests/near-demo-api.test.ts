import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { nearDemoApi } from '../near-demo/api.js';
import { DemoStore } from '../near-demo/store.js';
import { PaperDemo } from '../near-demo/service.js';
import { TestnetDemo } from '../near-demo/testnet.js';
import { TEST_USDC } from '../near-demo/types.js';
test('local API rejects cross-origin mutation, funded Intents actions and client dry override',async()=>{
  const store=new DemoStore(':memory:'),api=nearDemoApi({paper:new PaperDemo(store),vaultConfig:{network:'testnet',parentId:'fixture.testnet',vaults:[]},testnet:new TestnetDemo({network:'testnet',controllerId:'owner.testnet',reporterId:'owner.testnet',contractId:null,tokenId:TEST_USDC})});
  const server=createServer((req,res)=>void api.handle(req,res,()=>{res.writeHead(404);res.end();}));server.listen(0,'127.0.0.1');await once(server,'listening');const port=(server.address() as any).port,url=`http://127.0.0.1:${port}/api/near-demo`;
  try{
    const status=await (await fetch(url+'/status')).json() as any;assert.equal(status.mainnetTrading,false);
    for(const path of ['/submit-intent','/broadcast','/transfer']){const r=await fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':status.token},body:'{}'});assert.equal(r.status,400);}
    const bad=await fetch(url+'/create',{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':status.token,'Origin':'https://attacker.example'},body:'{}'});assert.equal(bad.status,403);
    const override=await fetch(url+'/cycle',{method:'POST',headers:{'Content-Type':'application/json','X-Pumpcoin-Demo-Token':status.token},body:JSON.stringify({id:'x',dry:false})});assert.equal(override.status,400);
  }finally{api.close();server.close();await once(server,'close');store.close();}
});
