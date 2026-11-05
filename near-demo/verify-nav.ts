import {verifiedVaultState} from './verify-vault.js';
import {readFileSync} from 'node:fs';import {verifyNavEvidence} from './nav-evidence.js';import {testnetReads} from './rpc.js';
const file=process.argv[2];if(!file)throw new Error('Usage: npm run nav:verify -- /path/to/price-evidence.json');
const evidence=JSON.parse(readFileSync(file,'utf8'));
// Replace embedded receipt with independently fetched chain evidence before verification.
evidence.receipt=await testnetReads().query('tx',{tx_hash:evidence.transactionHash,sender_account_id:evidence.reporterId,wait_until:'FINAL'});
const observed=await verifiedVaultState(evidence.contractId),state=observed.state;
if(state.strategy_id!==evidence.runId||state.strategy_hash!==evidence.strategyHash||state.reporter_id!==evidence.reporterId)
 throw new Error('NAV evidence differs from the reviewed vault and reporter binding.');
console.log(JSON.stringify({...verifyNavEvidence(evidence),vaultCode:'verified',blockHeight:observed.blockHeight},null,2));
