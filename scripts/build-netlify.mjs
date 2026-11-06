import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const raw = process.env.PUMP_PUBLIC_API_URL;
if (!raw) throw new Error('Set PUMP_PUBLIC_API_URL to the Railway public HTTPS origin.');
const api = new URL(raw);
if (api.protocol !== 'https:' || api.username || api.password || api.search || api.hash || api.pathname !== '/')
  throw new Error('PUMP_PUBLIC_API_URL must be an HTTPS origin without credentials, query, or path.');
for (const args of [['--prefix', 'app', 'ci'], ['run', 'build']]) {
  const result = spawnSync('npm', args, { stdio: 'inherit', env: { ...process.env, VITE_PUMP_HOSTED: '1' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
writeFileSync('app/dist/_redirects', [
  `/api/near-demo/public-* ${api.origin}/api/near-demo/public-:splat 200!`,
  `/api/pump-directory/* ${api.origin}/api/pump-directory/:splat 200!`,
  '/api/* /api-unavailable.json 404!',
  '/* /index.html 200',
  '',
].join('\n'));
writeFileSync('app/dist/api-unavailable.json', JSON.stringify({ error: 'This action is unavailable on the website.' }));
