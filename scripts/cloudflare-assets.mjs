import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const validName = name => typeof name === 'string' && /^[\w-]+\.[\w.-]+$/.test(name);
const digest = data => createHash('sha256').update(data).digest('hex');
function save(directory, name, data) {
  if (!validName(name)) throw new Error('Invalid retained asset filename.');
  mkdirSync(directory, { recursive: true });
  const target = join(directory, name);
  if (existsSync(target) && !readFileSync(target).equals(data)) throw new Error(`Asset collision: ${name}`);
  writeFileSync(target, data);
}
export function copyAssets(source, destination) {
  if (!existsSync(source)) return;
  for (const file of readdirSync(source, { withFileTypes: true })) {
    if (!file.isFile() || !validName(file.name)) throw new Error('Unexpected asset entry.');
    save(destination, file.name, readFileSync(join(source, file.name)));
  }
}
export function assetManifest(directory) {
  return { version: 1, assets: readdirSync(directory).sort().map(file => {
    if (!validName(file)) throw new Error('Invalid retained asset filename.');
    const data = readFileSync(join(directory, file));
    return { file, bytes: data.length, sha256: digest(data) };
  }) };
}
// The published manifest carries history into fresh checkouts and CI builds.
export async function retainPublishedAssets(origin, destination, fetcher = fetch) {
  const site = new URL(origin);
  if (site.protocol !== 'https:' || site.username || site.password || site.pathname !== '/' || site.search || site.hash)
    throw new Error('Asset history must be an HTTPS origin.');
  const response = await fetcher(new URL('/asset-manifest.json', site), { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not read published asset history: ${response.status}`);
  if (!(response.headers.get('content-type') ?? '').includes('application/json'))
    throw new Error('Published asset history did not return a JSON manifest.');
  const manifest = await response.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length > 10000)
    throw new Error('Invalid published asset history.');
  for (const asset of manifest.assets) {
    if (!validName(asset.file) || !/^[a-f0-9]{64}$/.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || asset.bytes > 25 * 1024 * 1024)
      throw new Error('Invalid published asset.');
    const target = join(destination, asset.file);
    if (existsSync(target) && digest(readFileSync(target)) === asset.sha256) continue;
    const result = await fetcher(new URL('/assets/' + asset.file, site), { redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (!result.ok) throw new Error(`Could not retain ${asset.file}: ${result.status}`);
    const data = Buffer.from(await result.arrayBuffer());
    if (data.length !== asset.bytes || digest(data) !== asset.sha256) throw new Error(`Retained asset checksum mismatch: ${asset.file}`);
    save(destination, asset.file, data);
  }
}
