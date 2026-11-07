import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assetManifest, copyAssets, retainPublishedAssets } from '../scripts/cloudflare-assets.mjs';

function fixture(t:TestContext) {
  const dir=mkdtempSync(join(tmpdir(),'pump-assets-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const old=join(dir,'old'),cache=join(dir,'cache'),release=join(dir,'release');
  for(const path of [old,cache,release])mkdirSync(path);
  writeFileSync(join(old,'inference-old.js'),'export const version=1;');
  return {old,cache,release};
}

test('a new deployment retains old lazy chunks and their dependencies without replacing its new bundle',t=>{
  const {old,cache,release}=fixture(t);
  writeFileSync(join(old,'engine-old.wasm'),Buffer.from([0,97,115,109]));
  copyAssets(old,cache);
  writeFileSync(join(release,'inference-new.js'),'export const version=2;');
  copyAssets(release,cache);copyAssets(cache,release);
  assert.equal(readFileSync(join(release,'inference-old.js'),'utf8'),'export const version=1;');
  assert.equal(readFileSync(join(release,'inference-new.js'),'utf8'),'export const version=2;');
  assert.equal(assetManifest(release).assets.length,3);
});

test('fresh checkouts restore published asset history with verified content',async t=>{
  const {old,release}=fixture(t),manifest=assetManifest(old);
  const fetcher:typeof fetch=async url=>String(url).endsWith('/asset-manifest.json')?
    Response.json(manifest):new Response(readFileSync(join(old,'inference-old.js')));
  await retainPublishedAssets('https://pump.example',release,fetcher);
  assert.deepEqual(assetManifest(release),manifest);
  await assert.rejects(retainPublishedAssets('https://pump.example',release,async url=>
    String(url).endsWith('/asset-manifest.json')?Response.json({...manifest,assets:[{...manifest.assets[0],file:'missing.js'}]}):new Response('wrong bytes')),/checksum/);
});

test('asset retention rejects conflicting bytes and paths outside the asset directory',async t=>{
  const {old,cache}=fixture(t);copyAssets(old,cache);
  writeFileSync(join(old,'inference-old.js'),'different bytes');
  assert.throws(()=>copyAssets(old,cache),/collision/);
  await assert.rejects(retainPublishedAssets('https://pump.example',cache,async()=>Response.json({
    version:1,assets:[{file:'../private.js',bytes:0,sha256:'a'.repeat(64)}]})),/Invalid published asset/);
  await assert.rejects(retainPublishedAssets('https://pump.example',cache,async()=>new Response('<html>')),
    /did not return a JSON manifest/);
});
