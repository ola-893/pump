import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';

function fingerprint(s: { dev: number; ino: number; size: number; mtimeMs: number; ctimeMs: number }) { return [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(':'); }
export class ArtifactHasher {
  private cache = new Map<string, { stamp: string; digest: string }>();
  async hash(path: string, onBytes: (bytes: number) => void = () => {}, gguf = false): Promise<{ sha256: string; bytes: number }> {
    const resolved = await realpath(path); const handle = await open(resolved, 'r');
    try {
      const before = await handle.stat(); if (!before.isFile()) throw new Error('Artifact is not a regular file.');
      if (gguf) { const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0); if (header.toString() !== 'GGUF') throw new Error('Reported weights are not a GGUF file.'); }
      const stamp = fingerprint(before), cached = this.cache.get(resolved); let digest = cached?.stamp === stamp ? cached.digest : '';
      if (!digest) {
        const sha = createHash('sha256'); let read = 0;
        for await (const chunk of handle.createReadStream({ start: 0, autoClose: false, highWaterMark: 4 * 1024 * 1024 })) { sha.update(chunk); read += chunk.length; onBytes(read); }
        digest = sha.digest('hex');
      } else onBytes(before.size);
      const after = await handle.stat(), current = await stat(path);
      if (fingerprint(after) !== stamp || fingerprint(current) !== stamp || await realpath(path) !== resolved) throw new Error('Artifact changed during hashing. Detect it again.');
      if (this.cache.size >= 128) this.cache.clear(); this.cache.set(resolved, { stamp, digest });
      return { sha256: digest, bytes: before.size };
    } finally { await handle.close(); }
  }
}
