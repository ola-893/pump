import {AgentVaults,ownedVaultAccount,type VaultConfig} from '../agent-vaults.js';
import type {NearAgents} from '../agents.js';import type {TestnetDemo} from '../testnet.js';
import type { JournalPage } from './public-journal.js';
import { strategySeedFactory } from '../../app/src/lib/strategy-seed-factory-config.js';
/** Published agents are read-only here. Owner run controls always stay on their computer. */
export function publishedVaults(entry:any,local:NearAgents,testnet:TestnetDemo,trusted:VaultConfig){
 const runs=entry.runs as any[],current=[...runs].sort((a,b)=>b.version-a.version)[0];
 const approved=(entry.vaults as any[]).filter(v=>v.liveNav&&v.factoryId===trusted.factory?.id&&v.codeHash===trusted.factory?.vaultCodeHash);
 const agents={read:(id:string)=>{if(id!==entry.agent.id)throw new Error('Agent unavailable.');return entry.agent;},visibility:()=> 'public',
  strategies:{read:(id:string)=>{const r=runs.find(x=>x.id===id);if(!r)throw new Error('Strategy unavailable.');return r;},active:()=>current},paper:{store:local.paper.store}};
 return new AgentVaults(agents as any,testnet,{network:'testnet',parentId:trusted.parentId,vaults:approved,ownedRecords:false});
}

/** Resolve only signed journal bindings and pin the contract code independently of the publisher. */
const verifiedSeeds=new Set<string>();
export async function journalVaults(page:JournalPage,local:NearAgents,testnet:TestnetDemo){
 const factory=strategySeedFactory;
 const selected=page.strategies.find(run=>run.id===page.strategyId);
 const vault=selected?.vault;
 if(!factory?.reporterId||!selected||!vault||
    vault.contractId!==ownedVaultAccount(selected.id,page.agent.controller,factory.id))
  throw new Error('This strategy has no verified investment vault binding.');
 const agent={id:page.agent.id,commitment:vault.manifestHash,manifest:{name:page.agent.name,controller:page.agent.controller}};
 const run={...selected,agentId:agent.id,commitment:vault.strategyHash,registrationCommitment:vault.manifestHash};
 const agents={read:()=>agent,visibility:()=> 'public',strategies:{read:()=>run,active:()=>page.strategies[0]},paper:{store:local.paper.store}};
 const remote=new AgentVaults(agents as unknown as NearAgents,testnet,{network:'testnet',parentId:factory.reporterId,ownedRecords:false,vaults:[{
  agentId:agent.id,runId:run.id,strategyHash:run.commitment,manifestHash:agent.commitment,contractId:vault.contractId,
  codeHash:factory.vaultCodeHash,factoryId:factory.id,ownerId:page.agent.controller,reporterId:factory.reporterId,liveNav:true,
 }]});
 const key=JSON.stringify([page.agent.controller,agent.id,run.id,vault]);
 if(!verifiedSeeds.has(key)){
  const receipt=await remote.receipt(agent.id,run.id,page.agent.controller,vault.seedReceipt);
  if(receipt.status!=='final'||receipt.effect.kind!=='deposit'||receipt.effect.outcome!=='confirmed'||receipt.effect.assets!==vault.seedAmount)
   throw new Error('This strategy’s owner deposit could not be verified.');
  if(verifiedSeeds.size>=256)verifiedSeeds.delete(verifiedSeeds.values().next().value!);
  verifiedSeeds.add(key);
 }
 return remote;
}
