import {verifyPublishedStrategy} from './strategy-evidence.js';
import {verifySignature,nep413Hash,publicationHash} from './signatures.js';import {digest,metrics} from '../ledger.js';
import {investorPerformance} from '../../app/src/lib/agent-performance.js';
export function verifyDirectoryRecord(record:any,origin:string){
 const {payload,publicKey,signature}=record.signedPublication??{};
 if(!payload||record.proof?.payloadHash!==publicationHash(payload).toString('hex')||!verifySignature(publicKey,publicationHash(payload),Buffer.from(signature,'base64')))throw new Error('Directory publication signature is invalid.');
 if(record.proof.reportedAt!==payload.at||record.proof.sequence!==payload.sequence||record.proof.owner!==payload.owner||record.proof.runnerKey!==publicKey)throw new Error('Directory checkpoint metadata differs from its signed publication.');
 const certificate=record.proof.ownerAuthorization,c=certificate?.challenge,signed=certificate?.signed;
 if(!c||!signed||c.account!==payload.owner||c.action!=='grant'||c.runnerKey!==publicKey||signed.accountId!==payload.owner||new URL(c.origin).origin!==new URL(origin).origin||c.recipient!=='pump-directory:'+new URL(c.origin).host||!verifySignature(signed.publicKey,nep413Hash(c.message,c.nonce,c.recipient),Buffer.from(signed.signature,'base64')))throw new Error('Directory owner authorization is invalid.');
 const message=JSON.parse(c.message);if(message.account!==c.account||message.runnerKey!==publicKey||message.action!=='grant'||message.origin!==c.origin||message.network!=='testnet'||message.challenge!==c.id)throw new Error('Directory authorization context differs.');
 const source=payload.entries.find((e:any)=>e.agent.id===record.entry.agent.id);if(!source||source.agent.manifest.controller!==payload.owner||source.agent.visibility!=='public'||digest(source.agent.manifest)!==source.agent.commitment)throw new Error('Public agent differs from its signed owner record.');
 const entry=structuredClone(source);
 for(const run of entry.runs){const h=entry.histories[run.id];verifyPublishedStrategy(entry.agent,run,h);if(h.session.head!==run.session.head||digest(h.session.portfolio)!==digest(run.session.portfolio)||digest(h.session.config)!==digest(run.config))throw new Error('Public performance differs from its source journal.');
  run.session.metrics=metrics(h.session);run.performance=investorPerformance(h.session,h.events);
  const models=h.events.filter((e:any)=>e.kind==='model'&&e.evidence==='live-local-model'),fills=h.events.filter((e:any)=>e.kind==='fill'&&['live-local-model','operator-exit'].includes(e.evidence));
  run.activity={operatorExits:fills.filter((e:any)=>e.evidence==='operator-exit').length,decisions:models.length,buys:fills.filter((e:any)=>e.action==='BUY').length,sells:fills.filter((e:any)=>e.action==='SELL').length,fills:fills.length,holds:h.events.filter((e:any)=>e.kind==='hold').length,blocked:h.events.filter((e:any)=>e.kind==='blocked').length,volume:String(fills.reduce((n:bigint,e:any)=>n+BigInt(e.action==='BUY'?e.quote.amountIn:e.quote.amountOut),0n)),latest:models.at(-1)?{at:models.at(-1).at,proposal:models.at(-1).model?.proposal}:null};
 }
 return {...record,entry};
}
