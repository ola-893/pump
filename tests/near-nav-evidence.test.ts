import {test} from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyNavEvidence} from '../near-demo/nav-evidence.js';import {digest} from '../near-demo/ledger.js';
function fixture(){const valuation={strategy:'hash',portfolio:{cash:'99000000',position:'0'},quote:null,equity:'99000000',observedAt:1793710000000,tracking:true};const args={evidence_hash:digest(valuation),run_id:'run',strategy_hash:'hash',equity:valuation.equity,observed_at_ms:valuation.observedAt,tracking:true};return {schema:'PUMP-NAV-EVIDENCE-v1',runId:'run',strategyHash:'hash',contractId:'vault.testnet',reporterId:'reporter.testnet',transactionHash:'transaction',args,valuation,history:null,receipt:{final_execution_status:'FINAL',status:{SuccessValue:''},transaction:{hash:'transaction',signer_id:'reporter.testnet',receiver_id:'vault.testnet',actions:[{FunctionCall:{method_name:'report_nav',deposit:'0',args:Buffer.from(JSON.stringify(args)).toString('base64')}}]},transaction_outcome:{outcome:{status:{SuccessValue:''}}},receipts_outcome:[]}};}
test('NAV verifier recomputes reported cash and exact confirmed transaction binding',()=>{assert.equal(verifyNavEvidence(fixture()).valid,true);});
test('custom-market NAV verifies a signed whole-position liquidation in native units and its return index',()=>{
 const {market,exit}=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-sol-eth-dry-quotes.json',import.meta.url),'utf8'));
 const config={market,initialCash:'100000000000000000'};
 const definition={id:'run',sessionId:'paper',config},commitment=digest(definition);
 const portfolio={cash:'90000000000000000',position:exit.amountIn};
 const equity=String((BigInt(portfolio.cash)+BigInt(exit.amountOut))*1000000n/BigInt(config.initialCash));
 const valuation={strategy:commitment,strategyDefinition:{...definition,commitment},
  sourceSession:{id:'paper',config},portfolio,quote:exit,equity,observedAt:Date.parse(exit.receivedAt),tracking:true};
 const bundle={...fixture(),strategyHash:commitment,valuation};
 Object.assign(bundle.args,{strategy_hash:commitment,equity,observed_at_ms:valuation.observedAt,evidence_hash:digest(valuation)});
 bundle.receipt.transaction.actions[0].FunctionCall.args=Buffer.from(JSON.stringify(bundle.args)).toString('base64');
 assert.equal(verifyNavEvidence(bundle).equity,equity);
 valuation.equity=String(BigInt(portfolio.cash)+BigInt(exit.amountOut));
 Object.assign(bundle.args,{equity:valuation.equity,evidence_hash:digest(valuation)});
 assert.throws(()=>verifyNavEvidence(bundle),/equity/);
});
test('NAV verifier rejects edited valuation commitments and false equity even if rehashed',()=>{const f=fixture();f.valuation.equity='120000000';assert.throws(()=>verifyNavEvidence(f),/commitment/);f.args.equity=f.valuation.equity;f.args.evidence_hash=digest(f.valuation);assert.throws(()=>verifyNavEvidence(f),/equity/);});
test('NAV verifier rejects an unquoted open position, substituted signer, and unrelated on-chain arguments',()=>{const a=fixture();a.valuation.portfolio.position='1';a.args.evidence_hash=digest(a.valuation);assert.throws(()=>verifyNavEvidence(a),/whole position/);const b=fixture();b.receipt.transaction.signer_id='attacker.testnet';assert.throws(()=>verifyNavEvidence(b),/identity/);const c=fixture();c.receipt.transaction.actions[0].FunctionCall.args=Buffer.from('{}').toString('base64');assert.throws(()=>verifyNavEvidence(c),/arguments/);});
