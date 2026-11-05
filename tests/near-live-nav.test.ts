import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {KeyPair} from 'near-api-js';
import {LiveVaultNav} from '../near-demo/live-vault-nav.js';
import {RpcQueryError} from '../near-demo/rpc.js';
const runId='00000000-0000-4000-8000-000000000001';
function fixture(){
 const db=new DatabaseSync(':memory:');let now=1793710000000,down=false,sends=0;const bytes:string[]=[];
 const session={revision:1,head:'abc',sequence:3,portfolio:{cash:'99000000',position:'0'}};
 const nav={reference_equity:'100000000',equity:'100000000',sequence:1,tracking:true,observed_at_ms:now-25000};
 const state={live_nav:nav,archived:false,pending:null,total_supply:'5000000',assets:'5000000',reserve:'1000000',nonce:1};
 const deployment={runId,agentId:'agent',liveNav:true,contractId:'vault.testnet',reporterId:'reporter.testnet',state};
 const vaults={list:()=>[deployment],config:()=>({parentId:'reporter.testnet'}),inspect:async()=>deployment,
  agents:{strategies:{read:()=>({id:runId,agentId:'agent',sessionId:'session',commitment:'a'.repeat(64)}),export:()=>({paper:{replay:{valid:true}}})},
   paper:{store:{db,read:()=>structuredClone(session)},view:()=>({state:'running'})}}};
 const provider={viewAccessKey:async()=>({nonce:0n,permission:'FullAccess'}),viewBlock:async()=>({header:{hash:'11111111111111111111111111111111'}}),
  sendTransactionUntil:async(tx:any)=>{sends++;bytes.push(Buffer.from(tx.encode()).toString('base64'));if(down)throw new Error('RPC offline');
   const args=JSON.parse(Buffer.from(tx.transaction.actions[0].functionCall.args).toString());
   Object.assign(nav,{equity:args.equity,sequence:args.sequence,observed_at_ms:args.observed_at_ms,tracking:args.tracking});
   return {final_execution_status:'FINAL',status:{SuccessValue:''},transaction_outcome:{outcome:{tokens_burnt:'1000000000000000000000',status:{SuccessValue:''}}},receipts_outcome:[]};}};
 const options={autoStart:false,now:()=>now,provider:provider as any,credential:{network:'testnet',account_id:'reporter.testnet',private_key:KeyPair.fromRandom('ed25519').toString()}};
 return {db,session,nav,state,bytes,options,vaults,reporter:new LiveVaultNav(vaults as any,options),setDown:(x:boolean)=>down=x,setNow:(x:number)=>now=x,getSends:()=>sends};
}
test('NAV outbox recovers the exact signed bytes after restart and persists/clears reporting alerts',async()=>{
 const f=fixture();try{f.setDown(true);await assert.rejects(f.reporter.sync(runId,true),/offline/);assert.equal(f.reporter.status()[0].attempts,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM near_nav_reports').get()!.n,1);f.reporter.close();
  const resumed=new LiveVaultNav(f.vaults as any,f.options);assert.equal(resumed.status()[0].error,'RPC offline');f.setDown(false);await resumed.sync(runId);
  assert.equal(f.bytes[0],f.bytes[1]);assert.equal(f.db.prepare('SELECT count(*) n FROM near_nav_reports').get()!.n,1);assert.deepEqual(resumed.status(),[]);resumed.close();
 }finally{f.reporter.close();f.db.close();}
});
test('NAV recovers an unknown signed report after its access-key nonce is finalized',async()=>{
 const f=fixture(),provider=f.options.provider;
 try {
  f.setDown(true);
  await assert.rejects(f.reporter.sync(runId,true),/offline/);
  f.setDown(false);
  const send=provider.sendTransactionUntil;
  let rejected=false;
  provider.sendTransactionUntil=async(tx:any)=>{
   if(!rejected){
    rejected=true;
    throw new RpcQueryError({data:{TxExecutionError:{InvalidTxError:{InvalidNonce:{}}}}});
   }
   assert.equal(tx.transaction.nonce,2n);
   return send(tx);
  };
  provider.viewAccessKey=async()=>({nonce:1n,permission:'FullAccess'});
  provider.sendJsonRpc=async(method:string,params:{wait_until:string})=>{
   assert.equal(method,'tx');
   assert.equal(params.wait_until,'NONE');
   throw new RpcQueryError({cause:{name:'UNKNOWN_TRANSACTION'}});
  };
  await f.reporter.sync(runId);
  const rows=f.db.prepare('SELECT receipt FROM near_nav_reports ORDER BY rowid').all() as {receipt:string}[];
  assert.equal(JSON.parse(rows[0].receipt).rejected,'invalid-nonce');
  assert.equal(JSON.parse(rows[1].receipt).final_execution_status,'FINAL');
  assert.deepEqual(f.reporter.status(),[]);
 } finally {f.reporter.close();f.db.close();}
});
test('NAV reports above the former daily gas cap and still records actual usage',async()=>{
 const f=fixture();try{
  const day=new Date(f.options.now()).toISOString().slice(0,10),spent=250000000000000000000000n;
  f.db.prepare('INSERT INTO near_nav_budget VALUES(?,?)').run(day,String(spent));
  await f.reporter.sync(runId,true);
  assert.equal(f.getSends(),1);
  assert.equal(f.db.prepare('SELECT spent FROM near_nav_budget WHERE day=?').get(day)!.spent,String(spent+1000000000000000000000n));
  assert.deepEqual(f.reporter.status(),[]);
 }finally{f.reporter.close();f.db.close();}
});
test('NAV rejects unfunded gains and resumes after surplus is actually funded',async()=>{
 const f=fixture();try{f.session.portfolio.cash='120000000';f.state.reserve='0';await assert.rejects(f.reporter.sync(runId,true),/surplus/);assert.equal(f.getSends(),0);
  f.state.reserve='1000000';await f.reporter.sync(runId,true);assert.equal(f.getSends(),1);assert.deepEqual(f.reporter.status(),[]);
 }finally{f.reporter.close();f.db.close();}
});
test('NAV rejects a replaced portfolio snapshot and never submits an inconsistent valuation',async()=>{
 const f=fixture();try{f.vaults.inspect=async()=>{f.session.revision++;return f.vaults.list()[0];};await assert.rejects(f.reporter.sync(runId,true),/portfolio changed/);assert.equal(f.getSends(),0);assert.deepEqual(f.reporter.status(),[]);
 }finally{f.reporter.close();f.db.close();}
});


test('wallet approval holds the same finalized nonce across reporter ticks and a restart',async()=>{
 const f=fixture();
 try{
  const nonce=f.state.nonce;
  f.nav.observed_at_ms=f.options.now()-5000;
  const vaults={...f.vaults,plan:async(_a:string,_action:string,_account:string,_amount:string,_run:string,observation:any)=>{
   assert.equal(observation.state.nonce,nonce);
   return [];
  }};
  const {approvalExpiresAt}=await f.reporter.investorPlan(vaults as any,'agent','withdraw','owner.testnet','100000',runId);
  assert.equal(approvalExpiresAt,f.options.now()+30000);
  await f.reporter.tick();assert.equal(f.getSends(),0);
  await assert.rejects(f.reporter.investorPlan(vaults as any,'agent','withdraw','owner.testnet','100000',runId),/already open/);
  f.reporter.close();
  const restarted=new LiveVaultNav(vaults as any,f.options);
  try{
   await restarted.tick();assert.equal(f.getSends(),0);
   f.setNow(approvalExpiresAt!+1);
   await restarted.tick();assert.equal(f.getSends(),1);
  }finally{restarted.close();}
 }finally{f.reporter.close();f.db.close();}
});

test('an investment refreshes an expired price and reserves the new nonce before wallet approval',async()=>{
 const f=fixture();
 try{
  f.nav.observed_at_ms=f.options.now()-61000;
  const send=f.options.provider.sendTransactionUntil;
  f.options.provider.sendTransactionUntil=async(tx:any)=>{const receipt=await send(tx);f.state.nonce++;return receipt;};
  const vaults={...f.vaults,plan:async(_agent:string,_action:string,_account:string,_amount:string,_run:string,observation:any)=>{
   assert.equal(observation.state.nonce,2);
   return [];
  }};
  const {approvalExpiresAt}=await f.reporter.investorPlan(vaults as any,'agent','deposit','owner.testnet','14000000',runId);
  assert.equal(approvalExpiresAt,f.options.now()+30000);
  assert.equal(f.getSends(),1);
  await f.reporter.tick();
  assert.equal(f.getSends(),1);
 }finally{f.reporter.close();f.db.close();}
});

test('investment planning recovers a pending report before opening the wallet window',async()=>{
 const f=fixture();
 try{
  f.setDown(true);
  await assert.rejects(f.reporter.sync(runId,true),/offline/);
  f.setDown(false);
  const send=f.options.provider.sendTransactionUntil;
  f.options.provider.sendTransactionUntil=async(tx:any)=>{
   const receipt=await send(tx);
   f.state.nonce++;
   return receipt;
  };
  const vaults={...f.vaults,plan:async(_agent:string,_action:string,_account:string,_amount:string,_run:string,observation:any)=>{
   assert.equal(observation.state.nonce,2);
   return [];
  }};
  const result=await f.reporter.investorPlan(vaults as any,'agent','deposit','owner.testnet','100000',runId);
  assert.equal(result.approvalExpiresAt,f.options.now()+30000);
  assert.deepEqual(f.bytes,[f.bytes[0],f.bytes[0]]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM near_nav_reports WHERE receipt IS NOT NULL').get()!.n,1);
 }finally{f.reporter.close();f.db.close();}
});

test('a failed price refresh or unresolved signed report cannot open a wallet approval window',async()=>{
 const f=fixture();
 try{
  const vaults={...f.vaults,plan:async()=>[]};
  const plan=()=>f.reporter.investorPlan(vaults as any,'agent','withdraw','owner.testnet','100000',runId);
  f.setDown(true);
  await assert.rejects(plan(),/offline/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM near_nav_approval').get()!.n,0);
  await assert.rejects(plan(),/still confirming/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM near_nav_approval').get()!.n,0);
 }finally{f.reporter.close();f.db.close();}
});

test('a lagging RPC cannot cause a second report or approval on a confirmed nonce',async()=>{
 const f=fixture();
 try{
  await f.reporter.sync(runId,true);
  const committedNonce=f.state.nonce;
  f.session.portfolio.cash='98000000';
  let requestedFresh=false;
  const vaults={...f.vaults,plan:async()=>[]};
  f.vaults.inspect=async (...args:unknown[])=>{
   requestedFresh=args[3]===true;
   return f.vaults.list()[0];
  };
  await assert.rejects(f.reporter.sync(runId,true),/has not caught up/);
  assert.equal(requestedFresh,true);
  assert.equal(f.getSends(),1);
  await assert.rejects(f.reporter.investorPlan(vaults as any,'agent','withdraw','owner.testnet','100000',runId),/has not caught up/);
  f.state.nonce=committedNonce+1;
  await f.reporter.sync(runId,true);
  assert.equal(f.getSends(),2);
 }finally{f.reporter.close();f.db.close();}
});

test('signed NAV recovery does not depend on a new quote or current portfolio',async()=>{
 const f=fixture();
 try{
  f.setDown(true);
  await assert.rejects(f.reporter.sync(runId,true),/offline/);
  f.session.portfolio.position='1';
  f.options.provider.viewAccessKey=async()=>{throw new Error('Must not sign again');};
  f.vaults.inspect=async()=>{throw new Error('Vault views are unavailable');};
  f.setDown(false);
  await f.reporter.sync(runId);
  assert.equal(f.bytes[0],f.bytes[1]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM near_nav_reports WHERE receipt IS NULL').get()!.n,0);
  assert.deepEqual(f.reporter.status(),[]);
 }finally{f.reporter.close();f.db.close();}
});

test('price evidence keeps the last confirmed report when a newer receipt fails',async()=>{
 const f=fixture();
 try{
  await f.reporter.sync(runId,true);
  const confirmed=f.reporter.evidence(runId).transactionHash;
  f.state.nonce++;
  f.session.portfolio.cash='98000000';
  const send=f.options.provider.sendTransactionUntil;
  f.options.provider.sendTransactionUntil=async(tx:unknown)=>{
   const result=await send(tx);
   return {...result,receipts_outcome:[{outcome:{tokens_burnt:'0',status:{Failure:{}}}}]};
  };
  await assert.rejects(f.reporter.sync(runId,true),/report failed/);
  assert.equal(f.reporter.evidence(runId).transactionHash,confirmed);
 }finally{f.reporter.close();f.db.close();}
});

test('queued custody reads finish before the valuation timestamp is taken',async()=>{
 const f=fixture();try{const before=f.options.now();f.vaults.inspect=async()=>{f.setNow(before+31000);return f.vaults.list()[0];};await f.reporter.sync(runId,true);assert.equal(f.getSends(),1);assert.equal(f.nav.observed_at_ms,before+31000);assert.deepEqual(f.reporter.status(),[]);}finally{f.reporter.close();f.db.close();}
});
