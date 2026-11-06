import { TESTNET_RPC } from './types.js';

export const TESTNET_RPCS=[TESTNET_RPC,'https://near-testnet.drpc.org','https://testnet-rpc.intea.rs'];
export class RpcQueryError extends Error {
 readonly data:any;
 constructor(data:any){super(data?.cause?.name==='UNKNOWN_ACCOUNT'?'Account is not active on NEAR testnet. Fund it with test NEAR first.':'NEAR testnet query failed; no result was confirmed.');this.data=data;}
}
/** Read-only failover: never turn an unavailable balance into zero or reuse a stale head. */
export class TestnetReads {
 private cooldown=new Map<string,number>();
 private nextSlot=0;
 private pending=new Map<string,Promise<any>>();
 private cache=new Map<string,{at:number;value:any}>();
 private fetcher:typeof fetch;private endpoints:string[];private now:()=>number;private headCacheMs:number;private paceMs:number;
 constructor(fetcher:typeof fetch=fetch,endpoints=TESTNET_RPCS,now=Date.now,headCacheMs=1500,paceMs=0){this.fetcher=fetcher;this.endpoints=endpoints;this.now=now;this.headCacheMs=headCacheMs;this.paceMs=paceMs;}
 async query(method:string,params:unknown,fresh=false):Promise<any>{
  if(fresh)return this.request(method,params);
  const key=JSON.stringify([method,params]),cached=this.cache.get(key);
  const ttl=method==='query'&&this.headCacheMs?((params as any)?.block_id?30000:this.headCacheMs):0;
  if(cached&&this.now()-cached.at<ttl)return structuredClone(cached.value);
  let task=this.pending.get(key);
  if(!task){task=this.request(method,params).then(value=>{
    if(ttl){if(this.cache.size>=256)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{at:this.now(),value});}
    return value;
   }).finally(()=>this.pending.delete(key));this.pending.set(key,task);}
  return structuredClone(await task);
 }
 private async request(method:string,params:unknown){
  for(const url of this.endpoints){
   if((this.cooldown.get(url)??0)>this.now())continue;
   try{
    if(this.paceMs){const slot=Math.max(this.now(),this.nextSlot);this.nextSlot=slot+this.paceMs;const delay=slot-this.now();if(delay>15000)throw new Error('RPC read queue is busy');if(delay)await new Promise(r=>setTimeout(r,delay));}
    const r=await this.fetcher(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({jsonrpc:'2.0',id:'pump-testnet',method,params}),signal:AbortSignal.timeout(8000)});
    if(!r.ok){this.cooldown.set(url,this.now()+(r.status===429?60000:5000));continue;}
    const data=await r.json() as any;
    if(data.error){
     if(data.error.code===-429||data.error.code===-32603||data.error.cause?.name==='TIMEOUT_ERROR'){
      this.cooldown.set(url,this.now()+(data.error.code===-429?60000:5000));continue;
     }
     throw new RpcQueryError(data.error);
    }
    if(!Object.hasOwn(data,'result'))throw new Error('Malformed RPC response');
    return data.result;
   }catch(e){if(e instanceof RpcQueryError)throw e;this.cooldown.set(url,this.now()+5000);}
  }
  throw new Error('NEAR testnet RPC unavailable. Available endpoints will retry automatically.');
 }
}
