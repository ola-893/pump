import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { assetManifest, copyAssets, retainPublishedAssets } from './cloudflare-assets.mjs';

const raw=process.env.PUMP_PUBLIC_API_URL;
if(!raw)throw new Error('Set PUMP_PUBLIC_API_URL to the Railway HTTPS origin.');
const api=new URL(raw);
if(api.protocol!=='https:'||api.username||api.password||api.pathname!=='/'||api.search||api.hash)
  throw new Error('PUMP_PUBLIC_API_URL must be an HTTPS origin without credentials, query, or path.');
// Keep content-addressed chunks available to tabs opened before this deployment.
const history = '.local/cloudflare-assets';
copyAssets('app/dist/assets', history);
// Only the first release on an origin can have no prior manifest.
if (process.env.PUMP_BOOTSTRAP_ASSET_HISTORY !== '1') {
  await retainPublishedAssets(process.env.PUMP_ASSET_HISTORY_ORIGIN ?? 'https://pump-near-893.pages.dev', history);
}
for(const args of [['--prefix','app','ci'],['run','build']]){
  const result=spawnSync('npm',args,{stdio:'inherit',env:{...process.env,VITE_PUMP_HOSTED:'1'}});
  if(result.status!==0)process.exit(result.status??1);
}
copyAssets('app/dist/assets', history);
copyAssets(history, 'app/dist/assets');
writeFileSync('app/dist/asset-manifest.json', JSON.stringify(assetManifest(history))+'\n');
const proxy=ts.transpileModule(readFileSync('near-demo/cloudflare-proxy.ts','utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},
}).outputText;
writeFileSync('app/dist/_worker.js',proxy+`
export default {
  fetch(request,env) {
    if(new URL(request.url).pathname.startsWith('/api/'))return proxyPublicApi(request,${JSON.stringify(api.origin)});
    return env.ASSETS.fetch(request);
  }
};
`);
// Serve static pages and the WASM runtime directly; only API calls use a Function.
writeFileSync('app/dist/_routes.json',JSON.stringify({version:1,include:['/api/*'],exclude:[]},null,2)+'\n');
writeFileSync('app/dist/_headers','/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n/asset-manifest.json\n  Cache-Control: no-store\n');
// Cloudflare's built-in SPA fallback serves BrowserRouter routes when 404.html is absent.
