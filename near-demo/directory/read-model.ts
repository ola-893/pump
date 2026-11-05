import {AgentVaults,type VaultConfig} from '../agent-vaults.js';
import type {NearAgents} from '../agents.js';import type {TestnetDemo} from '../testnet.js';
/** Published agents are read-only here. Owner run controls always stay on their computer. */
export function publishedVaults(entry:any,local:NearAgents,testnet:TestnetDemo,trusted:VaultConfig){
 const runs=entry.runs as any[],current=[...runs].sort((a,b)=>b.version-a.version)[0];
 const approved=(entry.vaults as any[]).filter(v=>v.liveNav&&v.factoryId===trusted.factory?.id&&v.codeHash===trusted.factory?.vaultCodeHash);
 const agents={read:(id:string)=>{if(id!==entry.agent.id)throw new Error('Agent unavailable.');return entry.agent;},visibility:()=> 'public',
  strategies:{read:(id:string)=>{const r=runs.find(x=>x.id===id);if(!r)throw new Error('Strategy unavailable.');return r;},active:()=>current},paper:{store:local.paper.store}};
 return new AgentVaults(agents as any,testnet,{network:'testnet',parentId:trusted.parentId,vaults:approved,ownedRecords:false});
}
