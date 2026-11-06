import {verifyPublishedStrategy} from './strategy-evidence.js';
import {verifySignature,publicationHash} from './signatures.js';
export {publicationHash} from './signatures.js';
import type {DatabaseSync} from 'node:sqlite';
import {DirectoryAuth} from './auth.js';
import {PublicJournalStore} from './journal-store.js';
import {canonical,digest,metrics} from '../ledger.js';
import {investorPerformance} from '../../app/src/lib/agent-performance.js';
const uuid=(id:unknown)=>typeof id==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id);
export class PumpDirectory{
 readonly auth:DirectoryAuth;
 readonly journals:PublicJournalStore;
 readonly db:DatabaseSync;private now:()=>number;
 constructor(db:DatabaseSync,origin:string,keyPermission?:ConstructorParameters<typeof DirectoryAuth>[2],now=Date.now){
  this.db=db;this.now=now;
  this.auth=new DirectoryAuth(db,origin,keyPermission,now);
  db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS directory_runners(owner TEXT NOT NULL,key TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0,sequence INTEGER NOT NULL DEFAULT 0,proof TEXT NOT NULL,PRIMARY KEY(owner,key));
   CREATE TABLE IF NOT EXISTS directory_agents(id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL,updated INTEGER NOT NULL,runner TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS directory_publications(hash TEXT PRIMARY KEY,body TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS directory_strategy_bindings(run_id TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE,agent_id TEXT NOT NULL);`);
  this.journals=new PublicJournalStore(db,now);
  if(!(db.prepare('PRAGMA table_info(directory_agents)').all() as {name:string}[]).some(x=>x.name==='hidden'))db.exec('ALTER TABLE directory_agents ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0');
  // Retain identity reservations even when an agent is hidden or its runner is revoked.
  db.exec('BEGIN IMMEDIATE');try{
   for(const row of db.prepare('SELECT id,body FROM directory_agents').all() as {id:string;body:string}[])
    for(const run of JSON.parse(row.body).entry.runs){this.assertBinding(run.id,run.sessionId,row.id);db.prepare('INSERT OR IGNORE INTO directory_strategy_bindings VALUES(?,?,?)').run(run.id,run.sessionId,row.id);}
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}

 }
 private assertBinding(runId:string,sessionId:string,agentId:string){
  const found=this.db.prepare('SELECT * FROM directory_strategy_bindings WHERE run_id=? OR session_id=?').all(runId,sessionId) as {run_id:string;session_id:string;agent_id:string}[];
  if(found.some(r=>r.run_id!==runId||r.session_id!==sessionId||r.agent_id!==agentId))throw new Error('Strategy or session ID already belongs to another published record.');
 }
 async authorize(id:string,signed:any){const c=await this.auth.verify(id,signed);
  if(c.action==='grant')this.db.prepare('INSERT INTO directory_runners(owner,key,proof) VALUES(?,?,?) ON CONFLICT(owner,key) DO UPDATE SET revoked=0,proof=excluded.proof').run(c.account,c.runnerKey,canonical(c.proof));
  else this.db.prepare('UPDATE directory_runners SET revoked=1 WHERE owner=? AND key=?').run(c.account,c.runnerKey);
  return {owner:c.account,runnerKey:c.runnerKey,action:c.action};
 }
 publish(payload:any,key:string,signature:string){
  const runner=this.db.prepare('SELECT sequence,revoked,proof FROM directory_runners WHERE owner=? AND key=?').get(payload?.owner,key) as {sequence:number;revoked:number;proof:string}|undefined;
  if(!runner||runner.revoked||JSON.parse(runner.proof).challenge?.origin!==this.auth.origin)throw new Error('Runner is not authorized by this wallet owner.');
  if(payload.schema!=='PUMP-DIRECTORY-SNAPSHOT-v1'||!Number.isSafeInteger(payload.sequence)||payload.sequence<=runner.sequence||!Number.isSafeInteger(payload.at)||Math.abs(this.now()-payload.at)>60000||!Array.isArray(payload.entries)||payload.entries.length>100)throw new Error('Publication is stale, replayed or invalid.');
  const sig=Buffer.from(signature,'base64');if(sig.length!==64||!verifySignature(key,publicationHash(payload),sig))throw new Error('Invalid runner publication signature.');
  const sourceHash=publicationHash(payload).toString('hex'),envelope=canonical({payload,publicKey:key,signature});
  const ids=new Set<string>(),strategyIds=new Set<string>(),sessionIds=new Set<string>(),records:any[]=[];
  for(const entry of structuredClone(payload.entries)){
   const a=entry.agent;if(!a||!uuid(a.id)||ids.has(a.id)||a.visibility!=='public'||a.manifest?.controller!==payload.owner||a.commitment!==digest(a.manifest)||Object.hasOwn(a,'local'))throw new Error('Agent owner, privacy or manifest binding is invalid.');ids.add(a.id);
   const old=this.db.prepare('SELECT owner,body FROM directory_agents WHERE id=?').get(a.id) as {owner:string;body:string}|undefined;const journalOwner=this.db.prepare('SELECT owner FROM journal_agents WHERE id=?').get(a.id);if(old&&old.owner!==payload.owner||journalOwner&&journalOwner.owner!==payload.owner)throw new Error('This agent ID belongs to another wallet.');
   if(!Array.isArray(entry.runs)||!Array.isArray(entry.vaults)||!entry.histories||Object.values(entry.histories).some((h:any)=>!Array.isArray(h.events)))throw new Error('Publication needs inspectable strategy journals.');
   const previous=old?JSON.parse(old.body).entry:null;if(previous&&previous.agent.commitment!==a.commitment)throw new Error('An existing agent manifest cannot be replaced. Register a new agent for a new model identity.');
   const runIds=new Set<string>();
   for(const run of entry.runs){
    if(!uuid(run.id)||!uuid(run.sessionId)||runIds.has(run.id)||strategyIds.has(run.id)||sessionIds.has(run.sessionId)||run.agentId!==a.id||run.registrationCommitment!==a.commitment||run.session?.id!==run.sessionId||run.session?.agent?.strategyRunId!==run.id)throw new Error('Strategy identity binding differs.');runIds.add(run.id);strategyIds.add(run.id);sessionIds.add(run.sessionId);this.assertBinding(run.id,run.sessionId,a.id);
    const prior=previous?.runs.find((x:any)=>x.id===run.id);if(prior&&(prior.commitment!==run.commitment||digest(prior.config)!==digest(run.config)||run.session.sequence<prior.session.sequence))throw new Error('Published strategy history cannot be rewritten or rolled back.');
    const h=entry.histories[run.id];if(!h||h.session.id!==run.sessionId)throw new Error('Strategy journal unavailable.');verifyPublishedStrategy(a,run,h);
    if(prior&&prior.session.sequence>0&&h.events.find((e:any)=>e.sequence===prior.session.sequence)?.hash!==prior.session.head)throw new Error('Published journal prefix differs from its earlier checkpoint.');
    if(digest(h.session.config)!==digest(run.config)||h.session.agent?.id!==a.id||h.session.agent?.weightsHash!==a.manifest.model.sha256)throw new Error('Strategy policy or model differs from journal.');
    if(h.session.head!==run.session.head||h.session.sequence!==run.session.sequence||digest(h.session.portfolio)!==digest(run.session.portfolio))throw new Error('Published performance differs from its journal.');
    if(h.events.some((e:any)=>['operator-directed-model','manual-scenario','operator-mandate'].includes(e.evidence)))throw new Error('Execution exercises cannot become strategy performance.');
    run.performance=investorPerformance(h.session,h.events);
    run.session.metrics=metrics(h.session);
    run.session.valuationStale=h.session.portfolio.position!=='0'&&(!h.session.portfolio.markAt||this.now()-Date.parse(h.session.portfolio.markAt)>30000);
    const events=h.events,models=events.filter((e:any)=>e.kind==='model'&&e.evidence==='live-local-model'),fills=events.filter((e:any)=>e.kind==='fill'&&e.evidence==='live-local-model');
    run.activity={decisions:models.length,buys:fills.filter((e:any)=>e.action==='BUY').length,sells:fills.filter((e:any)=>e.action==='SELL').length,fills:fills.length,holds:events.filter((e:any)=>e.kind==='hold').length,blocked:events.filter((e:any)=>e.kind==='blocked').length,volume:String(fills.reduce((n:bigint,e:any)=>n+BigInt(e.action==='BUY'?e.quote.amountIn:e.quote.amountOut),0n)),latest:models.at(-1)?{at:models.at(-1).at,proposal:models.at(-1).model?.proposal}:null};
   }
   if(previous?.runs.some((r:any)=>!runIds.has(r.id)))throw new Error('Published strategy history cannot be dropped.');
   if(entry.vaults.some((v:any)=>v.agentId!==a.id||!runIds.has(v.runId)))throw new Error('Vault belongs to another agent or strategy.');
   records.push({entry,proof:{owner:payload.owner,ownerAuthorization:JSON.parse(runner.proof),runnerKey:key,sequence:payload.sequence,signature,payloadHash:sourceHash,reportedAt:payload.at,verification:'Wallet ownership and runner signature verified; journal replay checked. Model execution and market truth are not independently attested.'}});
  }
  if(payload.hiddenIds!==undefined&&(!Array.isArray(payload.hiddenIds)||payload.hiddenIds.length))throw new Error('Public agents stay public. Publication cannot be reversed.');
  this.db.exec('BEGIN IMMEDIATE');try{
   // Recheck the nonce inside the write transaction, including concurrent publishers.
   if(this.db.prepare('UPDATE directory_runners SET sequence=? WHERE owner=? AND key=? AND sequence<? AND revoked=0').run(payload.sequence,payload.owner,key,payload.sequence).changes!==1)throw new Error('Publication was already used or runner revoked.');
   this.db.prepare('INSERT OR IGNORE INTO directory_publications VALUES(?,?)').run(sourceHash,envelope);
   for(const r of records)this.db.prepare('INSERT INTO directory_agents(id,owner,body,updated,runner) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body,updated=excluded.updated,runner=excluded.runner,hidden=0').run(r.entry.agent.id,payload.owner,canonical(r),payload.at,key);
   for(const r of records)for(const run of r.entry.runs){this.assertBinding(run.id,run.sessionId,r.entry.agent.id);this.db.prepare('INSERT OR IGNORE INTO directory_strategy_bindings VALUES(?,?,?)').run(run.id,run.sessionId,r.entry.agent.id);}
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  return {accepted:records.length,sequence:payload.sequence};
 }
 catalog(offset=0,limit=24){
  offset=Math.max(0,Math.floor(offset)||0);limit=Math.min(100,Math.max(1,Math.floor(limit)||24));
  const rows=this.db.prepare('SELECT a.body,r.revoked FROM directory_agents a JOIN directory_runners r ON r.owner=a.owner AND r.key=a.runner WHERE a.hidden=0 ORDER BY a.updated DESC,a.id LIMIT ? OFFSET ?').all(limit,offset) as {body:string;revoked:number}[];
  return {total:Number(this.db.prepare('SELECT count(*) n FROM directory_agents WHERE hidden=0').get()!.n),offset,items:rows.map(r=>{const item=JSON.parse(r.body);const {histories:_histories,...summary}=item.entry;return {...item,entry:summary,offline:!!r.revoked||this.now()-item.proof.reportedAt>90000};})};
 }
 read(id:string){const r=this.db.prepare('SELECT body FROM directory_agents WHERE id=? AND hidden=0').get(id) as {body:string}|undefined;if(!r)throw new Error('Public agent unavailable.');const record=JSON.parse(r.body);const source=this.db.prepare('SELECT body FROM directory_publications WHERE hash=?').get(record.proof.payloadHash) as {body:string};const envelope=JSON.parse(source.body);if(envelope.payload.entries.some((e:any)=>this.db.prepare('SELECT hidden FROM directory_agents WHERE id=?').get(e.agent.id)?.hidden===1))throw new Error('The owner must republish this public record after a privacy change.');return {...record,signedPublication:envelope};}
}
