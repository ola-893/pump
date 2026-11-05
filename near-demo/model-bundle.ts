import type { Stats } from 'node:fs';
import { readFile,stat,realpath } from 'node:fs/promises';
import { dirname,join,basename } from 'node:path';
import { createHash } from 'node:crypto';
import { ArtifactHasher } from './artifact-hasher.js';
export type ClefBundle={schema:'PUMP-CLEF-BUNDLE-v1';name:string;runtime:'clef-mlx';context:4096;quantization:string;repository:string;revision:string;files:{name:string;bytes:number;sha256:string}[]};
const fingerprint=(s:Stats)=>[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');
export const isBundle=(p:string)=>basename(p)==='pump-classifier.json';
export async function readBundle(path:string):Promise<ClefBundle>{
 if(!isBundle(path)||(await stat(path)).size>65536)throw new Error('Invalid classifier bundle.');
 const b=JSON.parse(await readFile(path,'utf8')) as ClefBundle;
 if(b.schema!=='PUMP-CLEF-BUNDLE-v1'||b.runtime!=='clef-mlx'||b.context!==4096||typeof b.name!=='string'||b.name.length>80||!Array.isArray(b.files)||b.files.length<5||b.files.length>50||new Set(b.files.map(f=>f.name)).size!==b.files.length)throw new Error('Invalid classifier bundle.');
 for(const f of b.files){if(!/^[A-Za-z0-9_.-]+$/.test(f.name)||f.name==='.'||f.name==='..'||f.name==='pump-classifier.json'||!Number.isSafeInteger(f.bytes)||f.bytes<1||!/^[a-f0-9]{64}$/.test(f.sha256))throw new Error('Invalid classifier artifact.');if(dirname(await realpath(join(dirname(path),f.name)))!==await realpath(dirname(path)))throw new Error('Classifier artifact escapes its directory.');}
 const names=new Set(b.files.map(f=>f.name));for(const name of ['config.json','model.safetensors.index.json','joint_head.safetensors','joint_head_config.json','tokenizer.json','tokenizer_config.json','clef_mlx.py'])if(!names.has(name))throw new Error('Incomplete classifier bundle.');
 const index=JSON.parse(await readFile(join(dirname(path),'model.safetensors.index.json'),'utf8'));if(!index.weight_map||!Object.values(index.weight_map).every(n=>typeof n==='string'&&names.has(n)))throw new Error('Classifier index references missing weights.');
 return b;
}
export async function artifactStamp(path:string){if(!isBundle(path))return fingerprint(await stat(path));const b=await readBundle(path),parts=[fingerprint(await stat(path))];for(const f of b.files){const s=await stat(join(dirname(path),f.name));if(!s.isFile()||s.size!==f.bytes)throw new Error('Classifier artifact size changed.');parts.push(f.name+':'+fingerprint(s));}return 'bundle:'+createHash('sha256').update(parts.join('|')).digest('hex');}
export async function measureBundle(path:string,onProgress:(n:number)=>void=()=>{}){
 const b=await readBundle(path),before=await artifactStamp(path),hasher=new ArtifactHasher();let completed=0;
 for(const f of b.files){const measured=await hasher.hash(join(dirname(path),f.name),n=>onProgress(completed+n));if(measured.sha256!==f.sha256)throw new Error('Classifier artifact checksum changed: '+f.name);completed+=f.bytes;}
 if(await artifactStamp(path)!==before)throw new Error('Classifier artifacts changed during measurement.');
 return {sha256:createHash('sha256').update(await readFile(path)).digest('hex'),stamp:before,bundle:b};
}
