import {verifyDirectoryRecord} from './verify.js';
import {KeyPair} from 'near-api-js';
import {mkdirSync,readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {homedir} from 'node:os';import {join} from 'node:path';
import {digest} from '../ledger.js';
import {testAccount} from '../types.js';
import type {NearAgents} from '../agents.js';import type {AgentVaults} from '../agent-vaults.js';
import {PumpDirectory,publicationHash} from './service.js';
/** One runner per operator computer. The key authorizes public records, never token transfers. */
export class DirectoryRunner{
 private timer:ReturnType<typeof setInterval>;private active=new Set<string>();private busy=false;private error='';
 private catalogCache:any[]=[];private cachedAt=0;
 private publishQueue:Promise<unknown>=Promise.resolve();
 private keyDirectory:string;
 private agents:NearAgents;private vaults:AgentVaults;private directory:PumpDirectory;private remote:string;
 constructor(agents:NearAgents,vaults:AgentVaults,directory:PumpDirectory,remote=process.env.PUMP_DIRECTORY_URL??'',keyDirectory=process.env.PUMP_RUNNER_KEY_DIR??join(homedir(),'.local/share/pump/runner-keys')){
  this.keyDirectory=keyDirectory;this.agents=agents;this.vaults=vaults;this.directory=directory;this.remote=remote;
  if(remote){const u=new URL(remote);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw new Error('Directory must use HTTPS or loopback HTTP.');}
  agents.paper.store.db.exec(`CREATE TABLE IF NOT EXISTS near_directory_links(owner TEXT PRIMARY KEY,enabled INTEGER NOT NULL,origin TEXT NOT NULL DEFAULT ''); CREATE TABLE IF NOT EXISTS near_directory_seen(owner TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(owner,id)); CREATE TABLE IF NOT EXISTS near_directory_sequences(owner TEXT PRIMARY KEY,sequence INTEGER NOT NULL)`);
  if(!(agents.paper.store.db.prepare('PRAGMA table_info(near_directory_links)').all() as {name:string}[]).some(c=>c.name==='origin'))agents.paper.store.db.exec("ALTER TABLE near_directory_links ADD COLUMN origin TEXT NOT NULL DEFAULT ''");
  // A saved permission must never follow a changed staging host. Legacy unscoped grants need a fresh wallet signature.
  for(const r of agents.paper.store.db.prepare('SELECT owner FROM near_directory_links WHERE enabled=1 AND origin=?').all(this.remote||this.directory.auth.origin) as {owner:string}[])this.active.add(r.owner);
  this.timer=setInterval(()=>void this.tick(),30000);this.timer.unref();
 }
 private key(owner:string){testAccount(owner);const dir=this.keyDirectory;mkdirSync(dir,{recursive:true,mode:0o700});const file=join(dir,digest(owner)+'.json');
  if(!existsSync(file))writeFileSync(file,JSON.stringify({owner,key:KeyPair.fromRandom('ed25519').toString()}),{mode:0o600,flag:'wx'});
  const stat=statSync(file);if((stat.mode&0o077)!==0||stat.uid!==process.getuid?.())throw new Error('Runner key must be private to this operating-system user.');
  const record=JSON.parse(readFileSync(file,'utf8'));if(record.owner!==owner)throw new Error('Runner owner differs.');return KeyPair.fromString(record.key);
 }
 private async request(path:string,body?:unknown){const r=await fetch(this.remote+path,{method:body?'POST':'GET',redirect:'error',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});const d=await r.json() as any;if(!r.ok)throw new Error(d.error??'Shared directory unavailable.');return d;}
 status(){return {mode:this.remote?'shared-directory':'local-directory',url:this.remote||this.directory.auth.origin,enabledOwners:[...this.active],error:this.error};}
 async challenge(owner:string,action:'grant'|'revoke'){
  if(!this.agents.records().some(a=>a.manifest.controller===owner))throw new Error('No local agents belong to this wallet.');
  const key=this.key(owner).getPublicKey().toString();return this.remote?this.request('/challenge',{account:owner,runnerKey:key,action}):this.directory.auth.challenge(owner,key,action);
 }
 async authorize(id:string,signed:any){const result=this.remote?await this.request('/authorize',{id,signed}):await this.directory.authorize(id,signed);
  const owner=result.owner;if(result.runnerKey!==this.key(owner).getPublicKey().toString())throw new Error('Authorization belongs to a different runner.');
  this.agents.paper.store.db.prepare('INSERT INTO near_directory_links(owner,enabled,origin) VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET enabled=excluded.enabled,origin=excluded.origin').run(owner,result.action==='grant'?1:0,this.remote||this.directory.auth.origin);
  if(result.action==='grant'){this.active.add(owner);await this.publish(owner);}else this.active.delete(owner);return {status:this.status()};
 }
 private entries(owner:string){
  const registry=this.agents.publicStatus();
  return registry.agents.filter(agent=>agent.manifest.controller===owner).map(agent=>{
   const snapshots=registry.strategyRuns.filter(run=>run.agentId===agent.id).map(run=>{
    const history=this.agents.paper.store.export(run.sessionId);
    const {endpoint:_endpoint,...config}=history.session.config;
    const session={...history.session,config};
    // The dashboard hides stale equity. The signed checkpoint must carry the
    // original journal portfolio so consumers can replay it independently.
    return {run:{...run,definition:this.agents.strategies.read(run.id),session:{...session,state:run.session.state}},history:{...history,session}};
   });
   return {
    agent,
    runs:snapshots.map(snapshot=>snapshot.run),
    vaults:this.vaults.list().filter(vault=>vault.agentId===agent.id),
    histories:Object.fromEntries(snapshots.map(({run,history})=>[run.id,history])),
   };
  });
 }
 publish(owner:string){
  const next=this.publishQueue.then(()=>this.sendPublication(owner));
  this.publishQueue=next.catch(()=>{});
  return next;
 }
 private async sendPublication(owner:string){const key=this.key(owner),entries=this.entries(owner),db=this.agents.paper.store.db;
  const sequence=Number(db.prepare('INSERT INTO near_directory_sequences VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET sequence=MAX(excluded.sequence,near_directory_sequences.sequence+1) RETURNING sequence').get(owner,Date.now())!.sequence);
  const payload={schema:'PUMP-DIRECTORY-SNAPSHOT-v1',owner,sequence,at:Date.now(),entries};
  for(const entry of entries)db.prepare('INSERT OR IGNORE INTO near_directory_seen VALUES(?,?)').run(owner,entry.agent.id);
  const body={payload,publicKey:key.getPublicKey().toString(),signature:Buffer.from(key.sign(publicationHash(payload)).signature).toString('base64')};
  const result=this.remote?await this.request('/publish',body):this.directory.publish(payload,body.publicKey,body.signature);this.error='';this.cachedAt=0;return result;
 }
 private async tick(){if(this.busy)return;this.busy=true;try{for(const owner of this.active)await this.publish(owner);}catch(e){this.error=e instanceof Error?e.message:'Directory update unavailable.';}finally{this.busy=false;}}
 async catalog(){if(Date.now()-this.cachedAt<5000)return this.catalogCache;const items=[];let offset=0,total=0;do{const page=this.remote?await this.request(`/catalog?offset=${offset}&limit=100`):this.directory.catalog(offset,100);items.push(...page.items);total=page.total;offset+=page.items.length;if(!page.items.length)break;}while(offset<total&&offset<1000);if(this.remote){
   const verified=[];
   for(let i=0;i<items.length;i+=4){
    const batch=await Promise.all(items.slice(i,i+4).map(async item=>{
     const record=await this.read(item.entry.agent.id);
     return {...item,entry:record.entry,proof:record.proof};
    }));
    verified.push(...batch);
   }
   this.catalogCache=verified;
  }else this.catalogCache=items;
  this.cachedAt=Date.now();return this.catalogCache;}
 async read(id:string){
  const record=this.remote?await this.request('/agents/'+encodeURIComponent(id)):this.directory.read(id);
  const verified=verifyDirectoryRecord(record,this.remote||this.directory.auth.origin);
  if(verified.entry.agent.id!==id)throw new Error('Directory returned a different agent.');
  const owner=verified.proof.ownerAuthorization.signed;
  // Recheck the wallet key with our own RPC. A directory can present a valid
  // signature from a different key and attach any account name to it.
  await this.directory.auth.assertCurrentOwnerKey(owner.accountId,owner.publicKey);
  return verified;
 }
 close(){clearInterval(this.timer);}
}
