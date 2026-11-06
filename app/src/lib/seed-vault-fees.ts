import { units, type WalletPlan } from '../../../near-demo/types.js';

type Fee = { send_not_sir:number; send_sir:number; execution:number };
export type WalletFeeConfig = {
  storage_amount_per_byte:string;
  min_gas_purchase_price:string;
  transaction_costs:{
    action_receipt_creation_config:Fee;
    action_creation_config:{ function_call_cost:Fee; function_call_cost_per_byte:Fee };
  };
};
export type SeedNearBalance = { available:bigint; required:bigint; shortfall:bigint };

function count(n:number) {
  if(!Number.isSafeInteger(n)||n<0)throw new Error('Could not verify NEAR testnet fees.');
  return BigInt(n);
}

/** An estimate at one finalized block for a wallet-paid FunctionCall. */
export function seedNearBalance(
  plan:WalletPlan, account:{ amount:string; locked:string; storage_usage:number },
  gasPrice:string, config:WalletFeeConfig,
):SeedNearBalance {
  if(plan.actions.length!==1||plan.actions[0].type!=='FunctionCall')throw new Error('Unsupported testnet fee estimate.');
  const call=plan.actions[0].params;
  const fees=config.transaction_costs;
  const {function_call_cost:base,function_call_cost_per_byte:byte}=fees.action_creation_config;
  const receipt=fees.action_receipt_creation_config;
  const bytes=BigInt(new TextEncoder().encode(call.methodName+JSON.stringify(call.args)).byteLength);
  const send=plan.signerId===plan.receiverId?'send_sir':'send_not_sir';
  const sendGas=count(receipt[send])+count(base[send])+bytes*count(byte[send]);
  const receiptGas=units(call.gas)+count(receipt.execution)+count(base.execution)+bytes*count(byte.execution);
  const price=units(gasPrice,false), floor=units(config.min_gas_purchase_price,false);
  const required=units(call.deposit)+sendGas*price+receiptGas*(price>floor?price:floor);
  const reserve=count(account.storage_usage)*units(config.storage_amount_per_byte)-units(account.locked);
  const liquid=units(account.amount)-(reserve>0n?reserve:0n);
  const available=liquid>0n?liquid:0n;
  return {available,required,shortfall:required>available?required-available:0n};
}
