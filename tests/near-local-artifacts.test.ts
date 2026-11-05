import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { ArtifactHasher } from '../near-demo/artifact-hasher.js';
import { allowedRequest } from '../near-demo/local-origin.js';

const sha = (x: string) => createHash('sha256').update(x).digest('hex');

test('Hasher reads actual bytes, rejects non-GGUF, and invalidates its cache after changes', async () => {
  const dir=await mkdtemp(join(tmpdir(),'pumpcoin-hash-'));try {
    const path=join(dir,'model.gguf');const h=new ArtifactHasher();await writeFile(path,'GGUFabc');assert.equal((await h.hash(path,()=>{},true)).sha256,sha('GGUFabc'));
    await writeFile(path,'GGUFxyz');assert.equal((await h.hash(path,()=>{},true)).sha256,sha('GGUFxyz'));
    await writeFile(path,'NOPEabc');await assert.rejects(h.hash(path,()=>{},true),/GGUF/);
    await writeFile(path,'GGUF'+ 'x'.repeat(8*1024*1024));let changed=false;
    await assert.rejects(h.hash(path,()=>{if(!changed){changed=true;writeFileSync(path,'GGUFchanged');}},true),/changed/);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test('Local helper rejects DNS rebinding, non-loopback peers and cross-origin callers', () => {
  const req=(host:string,origin?:string,remoteAddress='127.0.0.1')=>({headers:{host,origin},socket:{remoteAddress}} as Pick<IncomingMessage,'headers'|'socket'>);
  assert.equal(allowedRequest(req('127.0.0.1:5189','http://127.0.0.1:5189')),true);
  assert.equal(allowedRequest(req('evil.test:5189')),false);assert.equal(allowedRequest(req('localhost:5189','https://evil.test')),false);assert.equal(allowedRequest(req('127.0.0.1:5189',undefined,'192.168.1.5')),false);
});
