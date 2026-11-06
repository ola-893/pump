import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';

const raw=process.env.PUMP_PUBLIC_API_URL;
if(!raw)throw new Error('Set PUMP_PUBLIC_API_URL to the Railway HTTPS origin.');
const api=new URL(raw);
if(api.protocol!=='https:'||api.username||api.password||api.pathname!=='/'||api.search||api.hash)
  throw new Error('PUMP_PUBLIC_API_URL must be an HTTPS origin without credentials, query, or path.');
for(const args of [['--prefix','app','ci'],['run','build']]){
  const result=spawnSync('npm',args,{stdio:'inherit',env:{...process.env,VITE_PUMP_HOSTED:'1'}});
  if(result.status!==0)process.exit(result.status??1);
}
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
writeFileSync('app/dist/_headers','/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n');
// Cloudflare's built-in SPA fallback serves BrowserRouter routes when 404.html is absent.
