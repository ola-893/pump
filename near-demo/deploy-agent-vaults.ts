import { TESTNET_RPC } from './types.js';
// Testnet-only deployment. Creates keyless child accounts; never changes the clearing contract.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Account,JsonRpcProvider,SignedTransaction,actions,baseEncode} from 'near-api-js';
import {vaultAccount,type VaultConfig} from './agent-vaults.js';
import type {AgentRecord} from './agents.js';
import type {StrategyRun} from './strategy-runs.js';
import {digest} from './ledger.js';
const broadcast=process.argv.includes('--broadcast');
const cfg=JSON.parse(readFileSync('deployments/near-agent-vaults.json','utf8')) as VaultConfig;
if(cfg.network!=='testnet'||cfg.parentId!=='pumpcoin-demo-472db8.testnet')throw new Error('Unexpected testnet deployment parent.');
const strategyArg = process.argv.indexOf('--run-id');
const runId = strategyArg === -1 ? '' : process.argv[strategyArg+1];
if (!runId) throw new Error('Pass --run-id with the published strategy version to deploy.');
const contractId = vaultAccount(runId, cfg.parentId);
const db = new DatabaseSync('.local/near-demo/paper.sqlite', {readOnly:true});
let run: StrategyRun, agent: AgentRecord;
try {
 const row = db.prepare('SELECT body FROM near_strategy_runs WHERE id=?').get(runId) as {body:string}|undefined;
 if (!row) throw new Error('Unknown strategy version.');
 run = JSON.parse(row.body) as StrategyRun;
 const registration = db.prepare('SELECT body FROM near_agents WHERE id=?').get(run.agentId) as {body:string}|undefined;
 if (!registration) throw new Error('Unknown agent registration.');
 agent = JSON.parse(registration.body) as AgentRecord;
} finally {
 db.close();
}
const {commitment,...runBody} = run;
if (agent.visibility === 'private' || run.id !== runId || digest(runBody) !== commitment ||
    digest(agent.manifest) !== agent.commitment || run.registrationCommitment !== agent.commitment) {
 throw new Error('Publish a strategy with a verified registration and version binding first.');
}
const network=JSON.parse(readFileSync('deployments/near-demo-testnet.json','utf8'));
const path='contracts-near/target/wasm32-unknown-unknown/release/pump_agent_vault.wasm',wasm=readFileSync(path),sha256=createHash('sha256').update(wasm).digest('hex'),codeHash=baseEncode(createHash('sha256').update(wasm).digest());
const funding=(BigInt(wasm.length)+20000n)*10n**19n+10n**23n;
if(funding>5n*10n**24n)throw new Error('Vault funding exceeds the 5 test NEAR per-account limit.');
const provider=new JsonRpcProvider({url:TESTNET_RPC}),parent=await provider.viewAccount({accountId:cfg.parentId,blockQuery:{finality:'final'}});
const available=parent.amount-BigInt(parent.storage_usage)*10n**19n;
const targets = [{
 agentId:agent.id, runId, strategyHash:commitment, name:agent.manifest.name, manifestHash:agent.commitment, contractId,
 init:{agent_id:agent.id, manifest_hash:agent.commitment, strategy_id:runId, strategy_hash:commitment,
  name:agent.manifest.name, controller_id:network.controllerId, reporter_id:network.reporterId}
}];
const plan={network:'testnet',parentId:cfg.parentId,wasm:path,bytes:wasm.length,sha256,codeHash,fundingPerVault:String(funding),maximumTotalFunding:String(funding*BigInt(targets.length)),parentSpendableTestNear:available.toString(),targets,actions:['CreateAccount','Transfer','DeployContract','FunctionCall:new'],keysAdded:0,scope:'Isolated test USDC custody with trusted paper returns; no real swaps or mainnet.'};
const deploymentDir='.local/near-demo/agent-vaults';
const planPath=deploymentDir+'/'+runId+'.plan.json';
mkdirSync(deploymentDir,{recursive:true,mode:0o700});
if(!broadcast){writeFileSync(planPath,JSON.stringify(plan,null,2)+'\n');console.log(JSON.stringify(plan,null,2));process.exit(0);}
const reviewed=JSON.parse(readFileSync(planPath,'utf8'));
if(reviewed.sha256!==sha256||JSON.stringify(reviewed.targets)!==JSON.stringify(targets)||reviewed.fundingPerVault!==String(funding))throw new Error('Deployment differs from its reviewed plan.');
const credential=JSON.parse(readFileSync('.local/near-demo/testnet-deployer.json','utf8'));if(credential.network!=='testnet'||credential.account_id!==cfg.parentId)throw new Error('Wrong testnet signer.');
const signer=new Account(cfg.parentId,provider,credential.private_key);
const view=async(id:string,method:string)=>{const r=await fetch(TESTNET_RPC,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'vault-verify',method:'query',params:{request_type:'call_function',finality:'final',account_id:id,method_name:method,args_base64:'e30='}})});const x=await r.json() as any;if(x.error)throw new Error('Vault view failed.');return JSON.parse(Buffer.from(x.result.result).toString());};
const verified=[];
for(const t of targets){
 const journal=deploymentDir+'/'+t.runId+'.json';let accountState;
 try{accountState=await provider.viewAccount({accountId:t.contractId,blockQuery:{finality:'final'}});}catch(e){if(!/does not exist|UNKNOWN_ACCOUNT/i.test(String(e)))throw e;}
 if(accountState&&accountState.code_hash!==codeHash)throw new Error('An existing target has different code; it will not be overwritten.');
 if(!accountState){
  let signed:SignedTransaction;
  if(existsSync(journal)){const j=JSON.parse(readFileSync(journal,'utf8'));if(j.sha256!==sha256||j.contractId!==t.contractId)throw new Error('A different signed deployment is journaled.');signed=SignedTransaction.decode(Buffer.from(j.signedBase64,'base64'));}
  else{const p=await provider.viewAccount({accountId:cfg.parentId,blockQuery:{finality:'final'}});if(p.amount-BigInt(p.storage_usage)*10n**19n<funding+5n*10n**22n)throw new Error('Parent needs additional faucet test NEAR. Reviewed funding per vault: '+funding);signed=await signer.createSignedTransaction({receiverId:t.contractId,actions:[actions.createAccount(),actions.transfer(funding),actions.deployContract(wasm),actions.functionCall('new',t.init,60000000000000n,0n)]});writeFileSync(journal,JSON.stringify({network:'testnet',sha256,contractId:t.contractId,hash:baseEncode(createHash('sha256').update(signed.transaction.encode()).digest()),signedBase64:Buffer.from(signed.encode()).toString('base64')},null,2)+'\n',{mode:0o600,flag:'wx'});}
  const receipt=await provider.sendTransactionUntil(signed,'FINAL');writeFileSync(journal+'.receipt.json',JSON.stringify(receipt,null,2)+'\n');
  if(receipt.final_execution_status!=='FINAL'||typeof receipt.status!=='object'||!('SuccessValue'in receipt.status)||receipt.receipts_outcome.some(x=>typeof x.outcome.status==='object'&&'Failure'in x.outcome.status))throw new Error('Deployment not confirmed; inspect the existing journal before retrying.');
 }
 const code=await provider.viewAccount({accountId:t.contractId,blockQuery:{finality:'final'}}),keys=await provider.viewAccessKeyList({accountId:t.contractId,finalityQuery:{finality:'final'}}),state=await view(t.contractId,'get_state');
 if(code.code_hash!==codeHash||keys.keys.length!==0||state.version!=='PUMP-STRATEGY-VAULT-v2'||state.strategy_id!==t.runId||state.strategy_hash!==t.strategyHash||state.agent_id!==t.agentId||state.manifest_hash!==t.manifestHash||state.controller_id!==network.controllerId||state.reporter_id!==network.reporterId||state.environment!=='testnet-paper-rounds')throw new Error('Vault code, keylessness or identity could not be verified.');
 const record={agentId:t.agentId,runId:t.runId,strategyHash:t.strategyHash,manifestHash:t.manifestHash,contractId:t.contractId,codeHash};const next={...cfg,vaults:[...cfg.vaults.filter(x=>x.runId!==t.runId),record]};cfg.vaults=next.vaults;writeFileSync('deployments/near-agent-vaults.json',JSON.stringify(cfg,null,2)+'\n');verified.push({name:t.name,...record,transactionHash:existsSync(journal+'.receipt.json')?JSON.parse(readFileSync(journal+'.receipt.json','utf8')).transaction.hash:null,accessKeys:0,state});
}
writeFileSync('docs/testing/near-strategy-vault-'+runId+'.json',JSON.stringify({observedAt:new Date().toISOString(),network:'testnet',wasmSha256:sha256,vaults:verified},null,2)+'\n');console.log(JSON.stringify({network:'testnet',deployed:verified.map(v=>({name:v.name,contractId:v.contractId,accessKeys:0})),wasmSha256:sha256},null,2));
