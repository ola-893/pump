import type { SeedFactory } from './seed-vault.js';
import deployment from '../../../deployments/near-agent-vaults.json' with { type:'json' };

// Reuse the existing, keyless strategy vault factory on NEAR testnet.
export const strategySeedFactory: SeedFactory = deployment.factory;
