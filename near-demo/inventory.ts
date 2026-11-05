import { readdir, realpath, stat, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { ArtifactHasher } from './artifact-hasher.js';

import { artifactStamp,isBundle,readBundle,measureBundle } from './model-bundle.js';
import type { InstalledModel } from './public-types.js';
export type { InstalledModel };
type Artifact = InstalledModel & { path:string; stamp:string };
export function stamp(s:{dev:number;ino:number;size:number;mtimeMs:number;ctimeMs:number}) { return [s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':'); }
/** Read only standard model directories. No downloads, moves, or model copies. */
export class ModelInventory {
  private artifacts=new Map<string,Artifact>();
  private hasher=new ArtifactHasher();
  progress:{modelId:string;completedBytes:number;totalBytes:number}|null=null;
  private roots:string[];private ollama:string;
  constructor(roots=[join(homedir(),'.local/share/llama.cpp'),join(homedir(),'.lmstudio/models'),join(homedir(),'.cache/lm-studio/models'),join(homedir(),'.cache/huggingface/hub')],ollama=join(homedir(),'.ollama/models')){this.roots=roots;this.ollama=ollama;}
  list():InstalledModel[]{return [...this.artifacts.values()].map(({path:_path,stamp:_stamp,...m})=>m);}
  async scan(){
    const paths:string[]=[],bundles:string[]=[];let visited=0;
    async function walk(dir:string,depth:number){if(depth>9||visited>15000)return;let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
      for(const e of entries){if(++visited>15000)break;const p=join(dir,e.name);if(e.isFile()&&e.name==='pump-classifier.json')bundles.push(p);if(e.isDirectory())await walk(p,depth+1);else if((e.isFile()||e.isSymbolicLink())&&e.name.toLowerCase().endsWith('.gguf')&&!/mmproj|projector|-\d{5}-of-\d{5}\.gguf$/i.test(e.name))paths.push(p);}
    }
    for(const root of this.roots)await walk(root,0);
    // Ollama blobs have no extension. Resolve only blobs actually referenced by a local manifest.
    async function manifests(dir:string,depth:number):Promise<void>{if(depth>7)return;let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}for(const e of entries){const p=join(dir,e.name);if(e.isDirectory())await manifests(p,depth+1);else if(e.isFile()){try{if((await stat(p)).size>65536)continue;const m=JSON.parse(await readFile(p,'utf8'));for(const l of m.layers??[])if(l.mediaType==='application/vnd.ollama.image.model'&&/^sha256:[a-f0-9]{64}$/.test(l.digest))paths.push(join(dir.split('/manifests')[0],'blobs',l.digest.replace(':','-')));}catch{}}}}
    await manifests(join(this.ollama,'manifests'),0);
    const next=new Map<string,Artifact>(),inodes=new Map<string,string>();
    for(const path of paths){try{const resolved=await realpath(path),s=await stat(resolved);if(!s.isFile()||s.size<24)continue;
      const inode=`${s.dev}:${s.ino}`,existing=inodes.get(inode);if(existing){next.get(existing)!.copies++;continue;}
      const f=await open(resolved,'r');let header;try{header=Buffer.alloc(4);await f.read(header,0,4,0);}finally{await f.close();}if(header.toString()!=='GGUF')continue;
      const id=createHash('sha256').update(resolved).digest('hex'),filename=basename(path);
      const name=filename.replace(/\.gguf$/i,'').replace(/-UD-.*$|-(?:Q\d|IQ\d).*$/i,'');
      next.set(id,{id,name,filename,bytes:s.size,quantization:filename.match(/(?:I?Q\d[^.]*)/i)?.[0]??'See model metadata',copies:1,detectedAt:new Date().toISOString(),path:resolved,stamp:stamp(s)});inodes.set(inode,id);
    }catch{}}
    for(const path of bundles){try{const resolved=await realpath(path),b=await readBundle(resolved),id=createHash('sha256').update(resolved).digest('hex');next.set(id,{id,name:b.name,filename:'MLX bundle · '+b.files.filter(f=>f.name.endsWith('.safetensors')).length+' weight files',bytes:b.files.reduce((n,f)=>n+f.bytes,0),quantization:b.quantization,copies:1,detectedAt:new Date().toISOString(),path:resolved,stamp:await artifactStamp(resolved),runtime:'clef-mlx',context:4096});}catch{}}
    this.artifacts=next;return this.list();
  }
  resolve(id:string){const m=this.artifacts.get(id);if(!m)throw new Error('Select an installed model from a fresh local detection.');return m;}
  async measure(id:string){const m=this.resolve(id);this.progress={modelId:id,completedBytes:0,totalBytes:m.bytes};try{if(isBundle(m.path)){const measured=await measureBundle(m.path,n=>{this.progress={modelId:id,completedBytes:n,totalBytes:m.bytes};});if(measured.stamp!==m.stamp)throw new Error('Model changed; detect again.');return {...m,sha256:measured.sha256};}const hash=await this.hasher.hash(m.path,n=>{this.progress={modelId:id,completedBytes:n,totalBytes:m.bytes};},true);if(stamp(await stat(m.path))!==m.stamp)throw new Error('Model changed; detect again.');return {...m,sha256:hash.sha256};}finally{this.progress=null;}}
  /** A metadata change requires a fresh content hash before accepting a new stamp. */
  async revalidate(path:string,expected:string,sha256:string){
    if(!/^[a-f0-9]{64}$/.test(sha256))throw new Error('Registered model checksum is invalid.');
    let current:string;
    try{current=await artifactStamp(path);}catch{throw new Error('Registered weights are unavailable. Check the original model file.');}
    if(current===expected)return current;
    // Do not reuse the discovery cache for a registration repair.
    const measured=isBundle(path)?await measureBundle(path):await new ArtifactHasher().hash(path,()=>{},true);
    if(measured.sha256!==sha256)throw new Error('Registered model checksum changed. Register the new model before running it.');
    if(await artifactStamp(path)!==current)throw new Error('Model metadata changed during verification. Try again.');
    return current;
  }
  async unchanged(path:string,expected:string){let current;try{current=await artifactStamp(path);}catch{throw new Error('Registered weights are unavailable. Check the original model file.');}if(current!==expected)throw new Error('Registered weights changed. Detect and register the new artifact.');}
}
