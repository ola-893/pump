import type { InstalledModel } from '../../../near-demo/public-types.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

export type BrowserModel = InstalledModel & {
  measure(progress?: (completedBytes: number) => void): Promise<string>;
  openWeights?: (checksum: string, signal?: AbortSignal, progress?: (completedBytes: number) => void) => Promise<File>;
};

type DirectoryEntries = {
  kind: 'directory';
  name: string;
  values(): AsyncIterableIterator<DirectoryEntries | FileSystemFileHandle>;
};

export type ModelDirectory = DirectoryEntries & {
  queryPermission(options: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' }): Promise<PermissionState>;
};

export const pickModelDirectory = typeof window === 'undefined' ? undefined : (window as Window & {
  showDirectoryPicker?: (options: { id: string; mode: 'read' }) => Promise<ModelDirectory>;
}).showDirectoryPicker?.bind(window);

export class ModelFolderError extends Error {}

// Call directly from a button click, while Chrome can show a permission prompt.
export async function authorizeModelDirectory(directory: ModelDirectory | null) {
  try {
    if (directory?.requestPermission) {
      if (await directory.requestPermission({ mode: 'read' }) === 'granted') return directory;
      throw new ModelFolderError('Chrome needs read access to the registered model. Choose its folder to try again.');
    }
    if (!pickModelDirectory) throw new ModelFolderError('Open this agent in a browser that supports granting access to a local model folder.');
    return await pickModelDirectory({ id: 'pump-models', mode: 'read' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof DOMException && ['NotAllowedError', 'SecurityError'].includes(error.name)) {
      throw new ModelFolderError('Chrome couldn’t grant read access. Choose the model folder to try again.');
    }
    throw error;
  }
}

const maxEntries = 15_000;
const maxManifestBytes = 65_536;
const maxWeightIndexBytes = 4 * 1024 * 1024;
const modelVerificationLifetimeMs = 24 * 60 * 60 * 1000;
type ModelFile = File | FileSystemFileHandle;
type ModelFiles = Map<string, ModelFile>;
type ModelVerification = {
  handle: FileSystemFileHandle;
  size: number;
  modified: number;
  sample: string;
  verifiedAt: number;
};

function readModelFile(entry: ModelFile | undefined) {
  return entry && ('getFile' in entry ? entry.getFile() : entry);
}

async function hashFile(file: File, progress?: (completedBytes: number) => void, signal?: AbortSignal) {
  const hash = sha256.create();
  const chunkSize = 8 * 1024 * 1024;
  for (let start = 0; start < file.size; start += chunkSize) {
    signal?.throwIfAborted();
    const chunk = new Uint8Array(await file.slice(start, start + chunkSize).arrayBuffer());
    hash.update(chunk);
    progress?.(start + chunk.length);
  }
  signal?.throwIfAborted();
  return bytesToHex(hash.digest());
}

async function sampleWeights(file: File, signal?: AbortSignal) {
  const hash = sha256.create();
  const length = Math.min(file.size, 64 * 1024);
  const lastOffset = file.size - length;
  for (const offset of new Set([0, Math.floor(lastOffset / 2), lastOffset])) {
    signal?.throwIfAborted();
    hash.update(new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()));
  }
  signal?.throwIfAborted();
  return bytesToHex(hash.digest());
}

async function verifyWeights(file: File, handle: FileSystemFileHandle | undefined, checksum?: string, signal?: AbortSignal, progress?: (completedBytes: number) => void) {
  const sample = handle && await sampleWeights(file, signal);
  if (handle && checksum) {
    const saved = await folderStore('readonly', store => store.get(`verified-gguf:${checksum}`)).catch(() => undefined) as ModelVerification | undefined;
    const now = Date.now();
    if (saved && saved.verifiedAt <= now && saved.verifiedAt > now - modelVerificationLifetimeMs &&
        saved.size === file.size && saved.modified === file.lastModified && saved.sample === sample &&
        await handle.isSameEntry(saved.handle).catch(() => false)) {
      signal?.throwIfAborted();
      return checksum;
    }
  }
  const measured = await hashFile(file, progress, signal);
  if (checksum && measured !== checksum) throw new ModelFolderError('The selected weights do not match this agent’s checksum. Choose the original GGUF file’s folder.');
  if (handle && sample) {
    const verified: ModelVerification = { handle, size: file.size, modified: file.lastModified, sample, verifiedAt: Date.now() };
    await folderStore('readwrite', store => store.put(verified, `verified-gguf:${measured}`)).catch(() => {});
  }
  signal?.throwIfAborted();
  return measured;
}

function checkSize(size: number) {
  if (size > maxEntries) throw new Error('Choose a smaller folder containing your model weights.');
}

export async function scanModelDirectory(root: ModelDirectory, signal?: AbortSignal) {
  const files: ModelFiles = new Map();
  let visited = 0;
  async function walk(directory: DirectoryEntries, prefix: string) {
    for await (const entry of directory.values()) {
      signal?.throwIfAborted();
      checkSize(++visited);
      const path = prefix + entry.name;
      if (entry.kind === 'directory') await walk(entry, path + '/');
      else files.set(path, entry);
    }
  }
  await walk(root, '');
  return scanModelFiles(files, signal);
}

export function scanSelectedModelFiles(files: FileList) {
  checkSize(files.length);
  const entries: ModelFiles = new Map();
  for (const file of Array.from(files)) {
    const path = file.webkitRelativePath;
    entries.set(path ? path.slice(path.indexOf('/') + 1) : file.name, file);
  }
  return scanModelFiles(entries);
}

async function scanModelFiles(files: ModelFiles, signal?: AbortSignal) {
  const models = new Map<string, BrowserModel>();
  const checkedWeights = new Set<string>();
  const detectedAt = new Date().toISOString();

  async function addModel(path: string, modified: number, metadata: Omit<InstalledModel, 'id' | 'copies' | 'detectedAt'>, measure: BrowserModel['measure'], openWeights?: BrowserModel['openWeights']) {
    const key = JSON.stringify([path, metadata.bytes, modified]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    models.set(path, { ...metadata, id, copies: 1, detectedAt, measure, openWeights });
  }

  async function addGguf(path: string, filename: string) {
    if (checkedWeights.has(path)) return;
    checkedWeights.add(path);
    const entry = files.get(path);
    const file = await readModelFile(entry);
    if (!file || file.size < 24 || await file.slice(0, 4).text() !== 'GGUF') return;
    const handle = entry && 'getFile' in entry ? entry : undefined;
    const name = filename.replace(/\.gguf$/i, '').replace(/-UD-.*$|-(?:Q\d|IQ\d).*$/i, '');
    await addModel(path, file.lastModified, {
      name, filename, bytes: file.size,
      quantization: filename.match(/(?:I?Q\d[^.]*)/i)?.[0] ?? 'See model metadata',
      runtime: 'llama.cpp',
    }, async progress => verifyWeights(await currentFile(), handle, undefined, undefined, progress), async (checksum, signal, progress) => {
      const current = await currentFile();
      await verifyWeights(current, handle, checksum, signal, progress);
      return current;
    });
    async function currentFile() {
      const current = await readModelFile(entry);
      if (!current || current.size !== file!.size || current.lastModified !== file!.lastModified) throw new ModelFolderError('The model file changed while Pump was opening it. Choose its folder to try again.');
      return current;
    }
  }

  async function readManifest(path: string, maxBytes = maxManifestBytes) {
    const file = await readModelFile(files.get(path));
    if (!file || file.size > maxBytes) return;
    return JSON.parse(await file.text());
  }

  const requiredClefFiles = [
    'config.json', 'model.safetensors.index.json', 'joint_head.safetensors', 'joint_head_config.json',
    'tokenizer.json', 'tokenizer_config.json', 'clef_mlx.py',
  ];
  async function addClef(path: string) {
    const manifest = await readModelFile(files.get(path));
    if (!manifest || manifest.size > maxManifestBytes) return;
    const bundle = JSON.parse(await manifest.text());
    if (bundle?.schema !== 'PUMP-CLEF-BUNDLE-v1' || bundle.runtime !== 'clef-mlx' || bundle.context !== 4096 ||
      typeof bundle.name !== 'string' || !bundle.name || bundle.name.length > 80 || typeof bundle.quantization !== 'string' ||
      !Array.isArray(bundle.files) || bundle.files.length > 50) return;
    const prefix = path.slice(0, path.lastIndexOf('/') + 1);
    const names = new Set<string>();
    const artifacts: { name: string; sha256: string; bytes: number }[] = [];
    let bytes = 0;
    for (const artifact of bundle.files) {
      if (typeof artifact?.name !== 'string' || !/^[\w.-]+$/.test(artifact.name) ||
        ['.', '..', 'pump-classifier.json'].includes(artifact.name) || names.has(artifact.name) ||
        !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 ||
        typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) return;
      const file = await readModelFile(files.get(prefix + artifact.name));
      if (!file || file.size !== artifact.bytes) return;
      names.add(artifact.name);
      artifacts.push(artifact);
      bytes += file.size;
    }
    if (!requiredClefFiles.every(name => names.has(name))) return;
    const index = await readManifest(prefix + 'model.safetensors.index.json', maxWeightIndexBytes);
    if (!index?.weight_map || !Object.values(index.weight_map).every(name => typeof name === 'string' && names.has(name))) return;
    const weights = [...names].filter(name => name.endsWith('.safetensors')).length;
    await addModel(path, manifest.lastModified, { name: bundle.name, filename: `MLX bundle · ${weights} weight files`, bytes,
      quantization: bundle.quantization, runtime: 'clef-mlx', context: 4096 }, async progress => {
      const current = (await readModelFile(files.get(path)))!;
      const checksum = await hashFile(manifest);
      if (current.size !== manifest.size || current.lastModified !== manifest.lastModified || await hashFile(current) !== checksum) {
        throw new Error('The model bundle changed. Detect it again before registering.');
      }
      let completed = 0;
      for (const artifact of artifacts) {
        const file = (await readModelFile(files.get(prefix + artifact.name)))!;
        if (file.size !== artifact.bytes || await hashFile(file, bytes => progress?.(completed + bytes)) !== artifact.sha256) throw new Error('The model bundle could not be verified. Detect it again before registering.');
        completed += artifact.bytes;
      }
      return checksum;
    });
  }

  for (const path of files.keys()) {
    signal?.throwIfAborted();
    const filename = path.split('/').at(-1)!;
    try {
      if (/\.gguf$/i.test(filename) && !/mmproj|projector|-\d{5}-of-\d{5}\.gguf$/i.test(filename)) {
        await addGguf(path, filename);
      } else if (filename === 'pump-classifier.json') {
        await addClef(path);
      } else {
        const ollama = /^(.*\/)?manifests\/(.+)$/.exec(path);
        if (!ollama) continue;
        const manifest = await readManifest(path);
        if (!Array.isArray(manifest?.layers)) continue;
        for (const layer of manifest.layers) {
          if (layer?.mediaType !== 'application/vnd.ollama.image.model' || !/^sha256:[a-f0-9]{64}$/.test(layer.digest)) continue;
          await addGguf(`${ollama[1] ?? ''}blobs/${layer.digest.replace(':', '-')}`, ollama[2].split('/').slice(-2).join(':'));
        }
      }
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) throw error;
      // A malformed manifest or an unreadable entry should not hide other models.
    }
  }

  return [...models.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function folderStore(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pump-model-folder', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('folders');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction('folders', mode);
      const request = operation(transaction.objectStore('folders'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function lastModelDirectory(checksum?: string): Promise<ModelDirectory | undefined> {
  const directory = await folderStore('readonly', store => store.get(checksum ?? 'last')) as ModelDirectory | undefined;
  return directory ?? (checksum ? lastModelDirectory() : undefined);
}

export async function rememberModelDirectory(directory: ModelDirectory, checksum?: string) {
  await folderStore('readwrite', store => store.put(directory, checksum ?? 'last'));
}
