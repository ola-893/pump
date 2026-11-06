import { JsonRpcProvider } from 'near-api-js';
import { TESTNET_RPC } from './types.js';

import { TestnetReads, TESTNET_RPCS } from './rpc-reads.js';
export { RpcQueryError, TestnetReads, TESTNET_RPCS } from './rpc-reads.js';
const shared=new WeakMap<typeof fetch,TestnetReads>();
export function testnetReads(fetcher:typeof fetch=fetch){let rpc=shared.get(fetcher);if(!rpc){rpc=new TestnetReads(fetcher,TESTNET_RPCS,Date.now,fetcher===fetch?4000:0,fetcher===fetch?750:0);shared.set(fetcher,rpc);}return rpc;}
// Failover resubmits the identical signed transaction; the persistent NAV journal
// prevents a second transaction from being created after an ambiguous response.
class SharedTestnetProvider extends JsonRpcProvider{
 constructor(){super({url:TESTNET_RPC});}
 override sendJsonRpc(method:any,params:any):Promise<any>{return testnetReads().query(method,params);}
}
export function testnetProvider(){return new SharedTestnetProvider();}
