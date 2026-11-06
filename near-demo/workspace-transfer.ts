import type { AgentManifest, StrategyRun } from './public-types.js';
import type { Event, Session } from './types.js';

export type WorkspacePaper = { session: Session; events: Event[] };
export type WorkspaceStrategy = StrategyRun & { paper: WorkspacePaper };
export type SeedVault = { factoryId:string; contractId:string; owner:string; agentId:string; manifestHash:string; strategyId:string; strategyHash:string; amount:string };
export type WorkspaceAgent = {
  id: string;
  manifest: AgentManifest;
  commitment: string;
  paper: WorkspacePaper;
  runs: WorkspaceStrategy[];
  seedVault?: SeedVault;
};
export type WorkspaceTransfer = { version: 'PUMP-LOCAL-WORKSPACE-v1'; agents: WorkspaceAgent[] };
