import test from 'node:test';
import assert from 'node:assert/strict';
import { runSeedFunding } from '../app/src/lib/seed-funding-flow.js';
import type { SeedStep } from '../app/src/lib/seed-vault.js';

const kinds = ['deploy','storage','share-storage','open','fund','confirmed'] as const;
function step(kind: SeedStep['kind'], shortfall=0n): SeedStep {
  if (kind==='confirmed') return {kind,state:{contractId:'vault.testnet',blockHash:'4'.repeat(44),navSequence:0,
    assets:'10000',nonce:1,pending:null,archived:false,paused:false,
    shares:'10000',received:'10000',public:true,supply:'10000',tracking:false}};
  return {kind,balance:{available:10n,required:10n+shortfall,shortfall},plan:{
    network:'testnet',signerId:'owner.testnet',receiverId:'vault.testnet',description:kind,actions:[],
  }};
}

test('one funding action requests each approval in order and finishes only after confirmed seed',async()=>{
  const approvals:string[]=[],progress:string[]=[];
  let finished=0;
  await runSeedFunding({
    read:async()=>step('deploy'),
    approve:async kind=>{approvals.push(kind);return step(kinds[kinds.indexOf(kind)+1]);},
    onStep:next=>progress.push(next.kind),
    finish:async()=>{assert.equal(progress.at(-1),'confirmed');finished++;},
  });
  assert.deepEqual(approvals,kinds.slice(0,-1));
  assert.deepEqual(progress,kinds);
  assert.equal(finished,1);
});

test('a rejected approval pauses setup, and resuming reads the remaining on-chain step',async()=>{
  let next:SeedStep['kind']='deploy',reject=true,finished=0;
  const approvals:string[]=[];
  const flow={read:async()=>step(next),approve:async(kind:Exclude<SeedStep['kind'],'confirmed'>)=>{
    approvals.push(kind);
    if(kind==='fund'&&reject)throw new Error('User rejected');
    next=kind==='deploy'?'fund':'confirmed';
    return step(next);
  },onStep:()=>{},finish:async()=>{finished++;}};
  await assert.rejects(runSeedFunding(flow),/User rejected/);
  assert.equal(finished,0);
  reject=false;
  await runSeedFunding(flow);
  assert.deepEqual(approvals,['deploy','fund','fund']);
  assert.equal(finished,1);
});

test('a changed balance pauses before the next wallet request',async()=>{
  const approvals:string[]=[];
  const result=await runSeedFunding({read:async()=>step('deploy'),approve:async kind=>{
    approvals.push(kind);return step('storage',1n);
  },onStep:()=>{},finish:async()=>{assert.fail('Unfunded agent must not finish');}});
  assert.deepEqual(approvals,['deploy']);
  assert.equal(result.kind,'storage');
});

test('a resumed confirmed deposit finishes without repeating any wallet transaction',async()=>{
  let finished=false;
  await runSeedFunding({read:async()=>step('confirmed'),approve:async()=>assert.fail('Duplicate approval'),
    onStep:()=>{},finish:async()=>{finished=true;}});
  assert.equal(finished,true);
});

test('leaving the flow or changing wallets prevents subsequent approvals and completion',async()=>{
  let active=true,approved=0;
  await assert.rejects(runSeedFunding({read:async()=>step('deploy'),approve:async()=>{
    approved++;active=false;return step('fund');
  },onStep:()=>{if(!active)throw new Error('Setup paused');},finish:async()=>assert.fail('Interrupted setup')}),/Setup paused/);
  assert.equal(approved,1);
});
