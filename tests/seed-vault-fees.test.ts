import test from 'node:test';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { approveSeedStep, seedStep, seedVaultAccount } from '../app/src/lib/seed-vault.js';

test('vault setup checks prepaid gas and storage, rechecks after top-up, and blocks a stale approval',async t=>{
  const owner='alice.testnet', strategyId='00000000-0000-4000-8000-000000000001', factoryId='ps.pump.testnet';
  const factory={id:factoryId,codeHash:'factory-code',vaultCodeHash:base58.encode(new Uint8Array(32)),funding:'4496030000000000000000000'};
  const v={factoryId,contractId:seedVaultAccount(owner,strategyId,factoryId),owner,agentId:strategyId,
    manifestHash:'a'.repeat(64),strategyId,strategyHash:'b'.repeat(64),amount:'10000'};
  let amount='478033247330950899999994';
  const block='wallet-final-block';
  t.mock.method(globalThis,'fetch',async (_url:unknown, init:RequestInit)=>{
    const {method,params}=JSON.parse(String(init.body));
    if(method==='gas_price'){
      assert.deepEqual(params,[block]);
      return Response.json({result:{gas_price:'100000000'}});
    }
    if(method==='EXPERIMENTAL_protocol_config'){
      assert.deepEqual(params,{block_id:block});
      return Response.json({result:{runtime_config:{storage_amount_per_byte:'10000000000000000000',min_gas_purchase_price:'1000000000',
        transaction_costs:{
          action_receipt_creation_config:{execution:108059500000,send_not_sir:108059500000},
          action_creation_config:{function_call_cost:{execution:780000000000,send_not_sir:200000000000},
            function_call_cost_per_byte:{execution:2235934,send_not_sir:47683715}},
        }}}});
    }
    if(params.account_id===v.contractId)return Response.json({error:{cause:{name:'UNKNOWN_ACCOUNT'}}});
    if(params.account_id===owner)return Response.json({result:{amount,locked:'0',storage_usage:182,block_hash:block}});
    if(params.request_type==='view_account')return Response.json({result:{code_hash:factory.codeHash}});
    if(params.request_type==='view_access_key_list')return Response.json({result:{keys:[]}});
    const output=({ft_balance_of:'10000000',funding:factory.funding,vault_code_hash:Buffer.alloc(32).toString('base64')} as Record<string,string>)[params.method_name];
    assert.ok(output);
    return Response.json({result:{result:[...Buffer.from(JSON.stringify(output))]}});
  });
  const low=await seedStep(v,factory);
  assert.equal(low.kind,'deploy');
  assert.equal(low.balance.available,476213247330950899999994n);
  assert.ok(low.balance.required>4716000000000000000000000n && low.balance.required<4718000000000000000000000n);
  assert.equal(low.balance.shortfall,low.balance.required-low.balance.available);
  amount=String(low.balance.required+182n*10n**19n);
  const toppedUp=await seedStep(v,factory);
  assert.equal(toppedUp.kind,'deploy');
  assert.equal(toppedUp.balance.shortfall,0n);

  // Balance changed after rendering the enabled button. The click returns a
  // blocked step before reaching the wallet connector, which is unavailable here.
  amount=String(BigInt(amount)-1n);
  const rechecked=await approveSeedStep(v,factory,'deploy');
  assert.equal(rechecked.kind,'deploy');
  assert.equal(rechecked.balance.shortfall,1n);
});
