import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeModelDirectory, ModelFolderError, scanModelDirectory, scanSelectedModelFiles, type ModelDirectory } from '../app/src/lib/browser-models.js';

test('browser inference requests read permission from the initiating click for a saved model folder', async () => {
  const requests: string[] = [];
  const directory: ModelDirectory = {
    kind: 'directory', name: 'models',
    async *values() {},
    async queryPermission() { return 'prompt'; },
    async requestPermission({ mode }) {
      requests.push(mode);
      return 'granted';
    },
  };
  const authorization = authorizeModelDirectory(directory);
  assert.deepEqual(requests, ['read']);
  assert.equal(await authorization, directory);
  directory.requestPermission = async () => 'denied';
  await assert.rejects(authorizeModelDirectory(directory), ModelFolderError);
});

function modelFile(path: string, content: BlobPart) {
  const file = new File([content], path.split('/').at(-1)!, { lastModified: 1 });
  Object.defineProperty(file, 'webkitRelativePath', { value: `models/${path}` });
  return file;
}

test('browser directory scan descends into the permitted folder and checks GGUF headers', async () => {
  const weights = modelFile('Qwen-Q4_K_M.gguf', 'GGUF' + '0'.repeat(24));
  const impostor = modelFile('invalid.gguf', 'FAKE' + '0'.repeat(24));
  const nested = {
    name: 'nested', kind: 'directory',
    async *values() {
      for (const file of [weights, impostor]) yield { name: file.name, kind: 'file', getFile: async () => file };
    },
  };
  const root = { async *values() { yield nested; } } as unknown as ModelDirectory;
  const models = await scanModelDirectory(root);
  assert.deepEqual(models.map(({ name, quantization }) => ({ name, quantization })), [{ name: 'Qwen', quantization: 'Q4_K_M' }]);
  assert.equal((await scanModelDirectory(root))[0].id, models[0].id);
});

test('stopping a browser run cancels GGUF verification between file reads', async () => {
  const file = modelFile('Qwen.gguf', 'GGUF' + '0'.repeat(9 * 1024 * 1024));
  const [model] = await scanSelectedModelFiles([file] as unknown as FileList);
  const checksum = await model.measure();
  const progress: number[] = [];
  assert.equal(await model.openWeights!(checksum, undefined, completed => progress.push(completed)), file);
  assert.equal(progress.at(-1), file.size);
  assert.ok(progress.every((completed, index) => completed > (progress[index - 1] ?? 0)));
  const controller = new AbortController();
  const slice = file.slice.bind(file);
  const reads: number[] = [];
  file.slice = (start, end) => {
    reads.push(start!);
    const chunk = slice(start, end);
    controller.abort();
    return chunk;
  };
  await assert.rejects(model.openWeights!(checksum, controller.signal), { name: 'AbortError' });
  assert.deepEqual(reads, [0]);
});

test('a saved GGUF verification is reused only for the same recent file', async t => {
  const stored = new Map<string, unknown>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: {
    open() {
      const request = { onsuccess() {}, result: {
        close() {},
        transaction() {
          const transaction = { oncomplete() {}, objectStore: () => ({
            get: (key: string) => ({ result: stored.get(key) }),
            put(value: unknown, key: string) { stored.set(key, value); return { result: key }; },
          }) };
          queueMicrotask(() => transaction.oncomplete());
          return transaction;
        },
      } };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  });

  let now = 1_000_000_000;
  t.mock.method(Date, 'now', () => now);
  let file = modelFile('Muse.gguf', 'GGUF' + '0'.repeat(256 * 1024));
  let location = 'first';
  const root: ModelDirectory = {
    kind: 'directory', name: 'models', async queryPermission() { return 'granted'; },
    async *values() {
      const path = location;
      yield { kind: 'file', name: file.name, getFile: async () => file, path,
        isSameEntry: async (other: { path: string }) => path === other.path } as unknown as FileSystemFileHandle;
    },
  };
  const scan = async () => (await scanModelDirectory(root))[0];
  const checksum = await (await scan()).measure();
  const progress: number[] = [];
  const open = async () => (await scan()).openWeights!(checksum, undefined, bytes => progress.push(bytes));

  const day = 24 * 60 * 60 * 1000;
  now += day - 1;
  assert.equal(await open(), file);
  assert.deepEqual(progress, []);
  now++;
  assert.equal(await open(), file);
  assert.equal(progress.at(-1), file.size);

  progress.length = 0;
  location = 'different-folder';
  assert.equal(await open(), file);
  assert.equal(progress.at(-1), file.size);

  file = modelFile('Muse.gguf', 'GGUF' + '1' + '0'.repeat(256 * 1024 - 1));
  await assert.rejects(open(), /do not match this agent’s checksum/);
});

test('browser folder selection resolves Ollama blobs and rejects incomplete MLX bundles', async () => {
  const digest = 'a'.repeat(64);
  const artifactNames = ['config.json', 'model.safetensors.index.json', 'model.safetensors', 'joint_head.safetensors', 'joint_head_config.json', 'tokenizer.json', 'tokenizer_config.json', 'clef_mlx.py'];
  const weightMap = Object.fromEntries(Array.from({ length: 5_000 }, (_, index) => [`layer.${index}.weight`, 'model.safetensors']));
  const artifacts = artifactNames.map(name => modelFile(`clef/${name}`, name === 'model.safetensors.index.json'
    ? JSON.stringify({ weight_map: weightMap }) : 'artifact'));
  const bundle = modelFile('clef/pump-classifier.json', JSON.stringify({
    schema: 'PUMP-CLEF-BUNDLE-v1', runtime: 'clef-mlx', context: 4096, name: 'CLEF', quantization: '4 bit',
    files: artifacts.map(file => ({ name: file.name, bytes: file.size, sha256: digest })),
  }));
  const manifest = modelFile('ollama/manifests/registry/library/gemma/latest', JSON.stringify({
    layers: [{ mediaType: 'application/vnd.ollama.image.model', digest: `sha256:${digest}` }],
  }));
  const blob = modelFile(`ollama/blobs/sha256-${digest}`, 'GGUF' + '0'.repeat(24));
  const scan = (files: File[]) => scanSelectedModelFiles(files as unknown as FileList);

  assert.deepEqual((await scan([bundle, ...artifacts, manifest, blob])).map(model => [model.name, model.runtime]),
    [['CLEF', 'clef-mlx'], ['gemma:latest', 'llama.cpp']]);
  assert.deepEqual(await scan([bundle, ...artifacts.slice(1), manifest]), []);
});
