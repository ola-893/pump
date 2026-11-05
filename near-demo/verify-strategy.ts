import {readFileSync} from 'node:fs';
import {verifyStrategyEvidence,verifyStrategyVault} from './strategy-evidence.js';
import {verifiedVaultState} from './verify-vault.js';
const [file,contractId]=process.argv.slice(2);
if(!file)throw new Error('Usage: npm run strategy:verify -- /path/to/strategy-evidence.json [vault.testnet]');
const bundle=JSON.parse(readFileSync(file,'utf8'));
const result=verifyStrategyEvidence(bundle);
if(contractId){
 const observed=await verifiedVaultState(contractId);
 verifyStrategyVault(bundle,observed.state);
 console.log(JSON.stringify({...result,contractId,blockHeight:observed.blockHeight,codeHash:observed.codeHash,onChainCommitment:'verified'},null,2));
}else console.log(JSON.stringify({...result,onChainCommitment:'not requested'},null,2));
