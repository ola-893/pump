import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserRuntimeCache, runtimeDiagnostics } from '../app/src/lib/browser-runtime.js';

test('a failed WASM evaluation releases its resource and cannot be reused on retry',async()=>{
  const cache=new BrowserRuntimeCache<{isModelLoaded():boolean;exit():Promise<void>}>();
  let exits=0;
  const crashed={isModelLoaded:()=>true,exit:async()=>{exits++;throw new Error('WASM already aborted');}};
  cache.save('weights',crashed);
  await assert.rejects(cache.evaluate(crashed,async()=>{throw new Error('(ABORT)');}),/ABORT/);
  assert.equal(cache.get('weights'),undefined);
  assert.equal(exits,1);
  const replacement={isModelLoaded:()=>true,exit:async()=>{}};
  cache.save('weights',replacement);
  assert.equal(await cache.evaluate(replacement,async()=>42),42);
  assert.equal(cache.get('weights'),replacement);
  assert.equal(cache.get('other-weights'),undefined);
});

test('runtime diagnostics retain the native GPU failure rather than the generic abort',()=>{
  const diagnostics=runtimeDiagnostics();
  diagnostics.logger.error('ggml_webgpu: Queue work failed: Device lost');
  diagnostics.logger.error('Aborted()');
  assert.match(diagnostics.reason(new Error('(ABORT)')),/Device lost/);
});
