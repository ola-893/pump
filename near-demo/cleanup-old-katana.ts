// One-off, explicitly requested testnet cleanup. No API route or delete feature.
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {DemoStore} from './store.js';import {PaperDemo} from './service.js';import {NearAgents} from './agents.js';import {AgentVaults} from './agent-vaults.js';import {TestnetDemo} from './testnet.js';import {canonical,digest} from './ledger.js';
const oldId='8350fcee-969a-4e1b-88dc-53d9835a90c8',newId='7a53e877-92de-46eb-8b9f-3fb7cc5c535c',owner='157ebee42ecb62b60325ac8a31c8da0d60cc6f97d2604d71d68e52cab1c918ba';
const receiptFile='.local/near-demo/old-katana-public-cleanup-20261104.json';
const store=new DemoStore('.local/near-demo/paper.sqlite'),paper=new PaperDemo(store),agents=new NearAgents(paper),vaults=new AgentVaults(agents,new TestnetDemo(JSON.parse(readFileSync('deployments/near-demo-testnet.json','utf8'))));
try{
 const old=agents.read(oldId),replacement=agents.read(newId);
 if(old.manifest.controller!==owner||old.manifest.name!=='katana'||old.manifest.network!=='NEAR testnet'||old.commitment!==digest(old.manifest)||replacement.manifest.controller!=='rudepuma4060.testnet'||replacement.manifest.name!=='katana'||replacement.manifest.model.sha256!==old.manifest.model.sha256||agents.visibility(old)!=='public'||agents.visibility(replacement)!=='public')throw new Error('Cleanup identity differs from the approved original/replacement Katana.');
 const current=agents.strategies.active(newId),replacementVault=vaults.list().find(v=>v.agentId===newId&&v.runId===current?.id&&v.liveNav);
 if(!current||!replacementVault)throw new Error('Verified replacement strategy vault is required.');
 await vaults.inspect(newId,current.id,'',true);
 for(const s of store.list().filter(s=>s.agent?.id===oldId))if(paper.view(s).state==='running'||paper.execution.activeId===s.id)throw new Error('Original Katana must be stopped.');
 const observations=[];
 for(const v of vaults.list().filter(v=>v.agentId===oldId)){
  const o=await vaults.inspect(oldId,v.runId,'',true);
  if(o.state.assets!=='0'||o.state.total_supply!=='0'||o.state.reserve!=='0'||o.custodyBalance!=='0'||o.state.pending||o.state.round)throw new Error('Original Katana still holds investor funds, surplus or an unresolved round.');
  observations.push(o);
 }
 const removal={at:new Date().toISOString(),reason:'User-requested one-off removal of the superseded testnet Katana public listing; original records retained.',replacementAgentId:newId};
 if(old.publicListingRemoval){if(old.publicListingRemoval.replacementAgentId!==newId)throw new Error('Unexpected prior cleanup.');console.log(JSON.stringify({alreadyRemoved:true,oldId,replacementId:newId}));}
 else{
  if(!existsSync(receiptFile))writeFileSync(receiptFile,JSON.stringify({network:'testnet',authorization:'Explicit user instruction: remove old Katana publicly; do not implement agent deletion.',originalAgent:old,observations,replacementId:newId,removal},null,2)+'\n',{mode:0o600,flag:'wx'});
  store.db.exec('BEGIN IMMEDIATE');try{
   const changed=store.db.prepare('UPDATE near_agents SET body=? WHERE id=? AND body=?').run(canonical({...old,publicListingRemoval:removal}),oldId,canonical(old));
   if(changed.changes!==1)throw new Error('Original record changed during cleanup.');
   // This local directory may contain a retained checkpoint of the same test record.
   // No owner-controlled endpoint can perform this administrative exception.
   if(store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='directory_agents'").get())store.db.prepare('UPDATE directory_agents SET hidden=1 WHERE id=?').run(oldId);
   store.db.exec('COMMIT');
  }catch(e){store.db.exec('ROLLBACK');throw e;}
  console.log(JSON.stringify({removedFromPublic:true,oldId,replacementId:newId,originalManifestUnchanged:true,historyRetained:true}));
 }
 if(agents.publicStatus().agents.some(a=>a.id===oldId)||!agents.publicStatus().agents.some(a=>a.id===newId))throw new Error('Public catalog cleanup did not verify.');
}finally{paper.close();await agents.close();store.close();}
