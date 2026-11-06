import assert from 'node:assert/strict';
import test from 'node:test';
import { scanModelDirectory, scanSelectedModelFiles, type ModelDirectory } from '../app/src/lib/browser-models.js';

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
