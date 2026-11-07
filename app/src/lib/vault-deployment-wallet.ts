import { nearConnector } from './near-demo-wallet.js';
import { withAccountWallet } from './near-wallet-account.js';
import { testAccount, units, type WalletPlan } from '../../../near-demo/types.js';

export async function sendDeploymentPlan(plan:WalletPlan, account:string, agentId:string) {
  testAccount(account);
  const target = testAccount(plan.receiverId);
  if (plan.network !== 'testnet' || plan.signerId !== account || !target.endsWith('.testnet') ||
      plan.actions.length !== 1 || plan.actions[0].type !== 'FunctionCall')
    throw new Error('Connect the wallet named in this testnet approval.');
  const { methodName, args, deposit, gas } = plan.actions[0].params;
  const amount = units(deposit), limit = units(gas,false);
  if (methodName === 'deploy') {
    if (args.agent_id !== agentId || amount === 0n || amount > 5n*10n**24n ||
        limit !== 220_000_000_000_000n || !/^[a-f0-9]{64}$/.test(String(args.strategy_hash)))
      throw new Error('Invalid deployment funding or strategy binding.');
  } else {
    const valid = methodName==='archive' && args.agent_id===agentId ||
      methodName==='set_paused' && args.paused===true ||
      methodName==='publish' && Object.keys(args).length===0;
    if (!valid || amount!==0n || limit!==20_000_000_000_000n)
      throw new Error('Invalid strategy vault approval.');
  }
  return withAccountWallet(await nearConnector(),account,wallet=>wallet.signAndSendTransaction({signerId:account,receiverId:target,actions:plan.actions}));
}
