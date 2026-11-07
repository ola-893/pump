import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BrowserRuntimeCache, loadBrowserRuntime, runtimeDiagnostics } from '../app/src/lib/browser-runtime.js';

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

test('Muse retries a GPU queue timeout in a fresh worker with fewer offloaded layers', async () => {
  const file = { size: 15_878_222_368 } as File;
  const chatTemplate = readFileSync(new URL('../near-demo/muse-direct-answer.jinja', import.meta.url), 'utf8');
  const events: string[] = [];
  let workers = 0;
  const { runtime } = await loadBrowserRuntime(logger => {
    const worker = ++workers;
    return {
      isModelLoaded: () => worker === 2,
      isSupportWebGPU: () => true,
      exit: async () => { events.push(`exit ${worker}`); },
      loadModel: async (files, settings) => {
        assert.equal(files[0], file);
        assert.equal(settings.n_ctx, 4096);
        assert.equal(settings.no_kv_offload, true);
        assert.equal(settings.chat_template, chatTemplate);
        assert.equal(settings.jinja, true);
        events.push(`load ${worker} with ${settings.n_gpu_layers} GPU layers`);
        if (worker === 1) {
          logger.error('ggml_webgpu: Queue wait timed out after 30000 ms');
          throw new Error('WASM aborted');
        }
      },
    };
  }, file, { id: 'Muse-Glimmer-30B', context: 4096, chatTemplate }, new AbortController().signal, () => events.push('retry'));
  assert.deepEqual(events, ['load 1 with 48 GPU layers', 'exit 1', 'retry', 'load 2 with 44 GPU layers']);
  assert.equal(runtime.isModelLoaded(), true);
});

test('stopping during model load discards the worker without retrying', async () => {
  const controller = new AbortController();
  let exited = false;
  await assert.rejects(loadBrowserRuntime(() => ({
    isModelLoaded: () => true,
    isSupportWebGPU: () => true,
    exit: async () => { exited = true; },
    loadModel: async () => { controller.abort(); },
  }), { size: 15_878_222_368 } as File, { id: 'Muse-Glimmer-30B', context: 4096 }, controller.signal,
  () => assert.fail('stopping must not trigger a retry')), { name: 'AbortError' });
  assert.equal(exited, true);
});
