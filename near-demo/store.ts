import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical, verifyHistory } from './ledger.js';
import type { Event, Session } from './types.js';
export class DemoStore {
  readonly db:DatabaseSync;
  constructor(path:string) {
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.db=new DatabaseSync(path);this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL, lease TEXT, expires INTEGER); CREATE TABLE IF NOT EXISTS events(session TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(session,sequence));');
  }
  list():Session[]{return (this.db.prepare('SELECT body FROM sessions ORDER BY rowid DESC').all() as {body:string}[]).map(r=>JSON.parse(r.body));}
  read(id:string):Session { const row=this.db.prepare('SELECT body FROM sessions WHERE id=?').get(id) as {body:string}|undefined;if(!row)throw new Error('Paper session not found.');return JSON.parse(row.body); }
  create(s:Session){this.db.prepare('INSERT INTO sessions(id,revision,body) VALUES(?,?,?)').run(s.id,s.revision,canonical(s));}
  history(id:string):Event[]{this.read(id);return (this.db.prepare('SELECT body FROM events WHERE session=? ORDER BY sequence').all(id) as {body:string}[]).map(x=>JSON.parse(x.body));}
  lastQuotedValuation(id:string):Event|undefined {const row=this.db.prepare("SELECT body FROM events WHERE session=? AND json_extract(body,'$.kind') IN ('mark','dust') AND json_extract(body,'$.after.equity') IS NOT NULL AND json_extract(body,'$.after.markAt') IS NOT NULL ORDER BY sequence DESC LIMIT 1").get(id) as {body:string}|undefined;return row?JSON.parse(row.body):undefined;}
  recent(id:string):Event[]{this.read(id);return (this.db.prepare('SELECT body FROM events WHERE session=? ORDER BY sequence DESC LIMIT 120').all(id) as {body:string}[]).reverse().map(x=>JSON.parse(x.body));}
  acquire(id:string){const token=randomUUID(),r=this.db.prepare('UPDATE sessions SET lease=?,expires=? WHERE id=? AND (lease IS NULL OR expires<?)').run(token,Date.now()+300000,id,Date.now());if(r.changes!==1)throw new Error('Another cycle owns this session; wait for it to finish.');return token;}
  renew(id:string,token:string){const now=Date.now(),r=this.db.prepare('UPDATE sessions SET expires=? WHERE id=? AND lease=? AND expires>=?').run(now+300000,id,token,now);if(r.changes!==1)throw new Error('Session lease expired or changed.');}
  release(id:string,token:string){this.db.prepare('UPDATE sessions SET lease=NULL,expires=NULL WHERE id=? AND lease=?').run(id,token);}
  save(s:Session,token:string,event?:Event){this.db.exec('BEGIN IMMEDIATE');try{
    if(event&&(event.sequence!==s.sequence+1||event.previousHash!==s.head))throw new Error('Event checkpoint mismatch.');
    const next={...s,revision:s.revision+1,...(event?{sequence:event.sequence,head:event.hash,portfolio:event.after}:{})};
    const r=this.db.prepare('UPDATE sessions SET body=?,revision=?,expires=? WHERE id=? AND revision=? AND lease=? AND expires>=?').run(canonical(next),next.revision,Date.now()+300000,s.id,s.revision,token,Date.now());
    if(r.changes!==1)throw new Error('Session changed or lease expired.');
    if(event)this.db.prepare('INSERT INTO events(session,sequence,body) VALUES(?,?,?)').run(s.id,event.sequence,canonical(event));
    this.db.exec('COMMIT');return next;
  }catch(e){this.db.exec('ROLLBACK');throw e;}}
  export(id:string){const session=this.read(id),events=this.history(id);return {version:'PUMPCOIN-NEAR-PAPER-v1',session,events,replay:verifyHistory(session,events)};}
  close(){this.db.close();}
}
