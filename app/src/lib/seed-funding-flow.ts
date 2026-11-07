import type { SeedStep } from './seed-vault.js';

type FundingFlow = {
  read: () => Promise<SeedStep>;
  approve: (kind: Exclude<SeedStep['kind'], 'confirmed'>) => Promise<SeedStep>;
  onStep: (step: SeedStep) => void;
  finish: () => Promise<void>;
};

/** Continue one user-started setup through every wallet approval and confirmation. */
export async function runSeedFunding(flow: FundingFlow) {
  let step = await flow.read();
  flow.onStep(step);
  while (step.kind !== 'confirmed') {
    if (step.balance.shortfall > 0n) return step;
    step = await flow.approve(step.kind);
    flow.onStep(step);
  }
  await flow.finish();
  return step;
}
