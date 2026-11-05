import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TestnetReads,RpcQueryError} from '../near-demo/rpc.js';
const ok=(result:unknown)=>Response.json({jsonrpc:'2.0',result});
test('RPC rate limit cools down primary and fails over without changing the query',async()=>{
 let now=0;const calls:any[]=[];const f=async(url:any,init:any)=>{calls.push([url,JSON.parse(init.body).params]);return url==='primary'?new Response('',{status:429}):ok({balance:'20'});};
 const rpc=new TestnetReads(f as any,['primary','backup'],()=>now);
 assert.deepEqual(await rpc.query('query',{account:'alice'}),{balance:'20'});
 now=2000;await rpc.query('query',{account:'bob'});assert.deepEqual(calls.map(x=>x[0]),['primary','backup','backup']);
 now=62000;await rpc.query('query',{account:'carol'});assert.equal(calls[3][0],'primary');
});
test('RPC coalesces duplicate reads and expires head observations without returning stale data',async()=>{
 let now=0,count=0;const rpc=new TestnetReads((async()=>{count++;return ok({height:count});}) as any,['one'],()=>now);
 const [a,b]=await Promise.all([rpc.query('query',{}),rpc.query('query',{})]);assert.deepEqual(a,b);assert.equal(count,1);
 a.height=999;assert.equal((await rpc.query('query',{})).height,1);
 now=1600;assert.equal((await rpc.query('query',{})).height,2);
});
test('RPC outage rejects; it never fabricates a zero balance or serves an expired cache',async()=>{
 let now=0,down=false;const rpc=new TestnetReads((async()=>{if(down)throw new Error('offline');return ok('20000000');}) as any,['one','two'],()=>now);
 assert.equal(await rpc.query('query',{}),'20000000');now=2000;down=true;await assert.rejects(rpc.query('query',{}),/RPC unavailable/);
});
test('contract errors remain errors and missing accounts are not hidden by failover',async()=>{
 let count=0;const rpc=new TestnetReads((async()=>{count++;return Response.json({error:{cause:{name:'UNKNOWN_ACCOUNT'}}});}) as any,['one','two']);
 await assert.rejects(rpc.query('query',{}),e=>e instanceof RpcQueryError&&e.data.cause.name==='UNKNOWN_ACCOUNT');assert.equal(count,1);
});
test('RPC transport failure and malformed responses fail over to a confirmed response',async()=>{
 for(const first of [()=>{throw new Error('network');},()=>Response.json({oops:true})]){
  const rpc=new TestnetReads((async(url:any)=>url==='one'?first():ok('confirmed')) as any,['one','two']);
  assert.equal(await rpc.query('tx',{hash:'same-signed-tx'}),'confirmed');
 }
});
