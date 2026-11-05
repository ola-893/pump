// Browser QA uses only an in-memory registry and named protocol fixtures.
import { createServer } from '../app/node_modules/vite/dist/node/index.js';
import react from '../app/node_modules/@vitejs/plugin-react/dist/index.js';
import tailwind from '../app/node_modules/@tailwindcss/vite/dist/index.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { nearDemoApi } from '../near-demo/api.ts';
import { DemoStore } from '../near-demo/store.ts';
import { PaperDemo } from '../near-demo/service.ts';
import { liveQuotes } from '../near-demo/quotes.ts';
import { TestnetDemo } from '../near-demo/testnet.ts';
import { TEST_USDC } from '../near-demo/types.ts';
import { infer } from '../near-demo/model.ts';
import { digest, canonical } from '../near-demo/ledger.ts';
const raw=JSON.parse(readFileSync(new URL('../docs/testing/near-budget-20261020/signed-dry-quote.json',import.meta.url),'utf8')),now=()=>Date.parse(raw.timestamp);
const paper=new PaperDemo(new DemoStore(':memory:'),{quotes:()=>({get:(tokenIn,tokenOut,amountIn)=>liveQuotes(async()=>new Response(JSON.stringify(raw),{status:201}),now).get(tokenIn,tokenOut,amountIn,raw.quoteRequest.slippageTolerance)}),now,delay:async()=>{}});
const privacy=process.argv.includes('--privacy');
const api=nearDemoApi({paper,testnet:new TestnetDemo({network:'testnet',controllerId:'fixture.testnet',reporterId:'fixture.testnet',contractId:null,tokenId:TEST_USDC})});
const seeds=process.argv.includes('--many')?Array.from({length:137},(_,i)=>[`QA agent ${String(i+1).padStart(3,'0')}`,i%2?'Qwen fixture':'Gemma fixture']):[['katana','Muse fixture'],['okina','Qwen fixture'],['nagakiba','Gemma fixture']];
for(const [index,[name,model]] of seeds.entries()){
 const hidden=privacy&&index===0;
 const config={name,initialCash:'100000000',tradeCap:'20000000',exposureCap:'80000000',dailyTurnoverCap:'100000000',slippageBps:50,executionDelayMs:1500,maxQuoteAgeMs:30000,source:'live',endpoint:'http://127.0.0.1:8093/v1',strategy:hidden?'PRIVATE_QA_SENTINEL: HOLD unless the secret local entry signal is met.':'Named browser fixture; do not use as real inference evidence.',intervalMs:60000},s=paper.create(config);
 const manifest={version:'PUMPCOIN-NEAR-AGENT-v1',name,controller:process.argv.includes('--many')?`creator${index%7}.testnet`:'fixture.testnet',network:'NEAR testnet',model:{id:model,filename:'fixture.gguf',bytes:100,sha256:'a'.repeat(64),quantization:'fixture'},inference:{policy:'self-hosted-only',runtime:'llama.cpp',context:4096,attestation:'none'},strategy:{description:config.strategy,pair:'wNEAR / USDC',tradeCap:config.tradeCap,exposureCap:config.exposureCap,dailyTurnoverCap:config.dailyTurnoverCap,slippageBps:50,intervalMs:60000},mode:'paper trading; optional Circle testnet clearing',evidence:'locally measured weights; unsigned local declaration'};
 const a={visibility:hidden?'private':'public',id:randomUUID(),createdAt:new Date().toISOString(),manifest,commitment:digest(manifest),sessionId:s.id,local:{modelId:'named-browser-fixture-'+name,path:'/fixture/never-load.gguf',stamp:'fixture'}};paper.store.db.prepare('INSERT INTO near_agents(id,body) VALUES(?,?)').run(a.id,canonical(a));
 if(hidden||process.argv.includes('--many')&&index%3===0)api.agents.strategies.save(a.id,0,{label:'QA strategy '+(index+1),strategy:config.strategy,initialCash:config.initialCash,tradeCap:config.tradeCap,exposureCap:config.exposureCap,dailyTurnoverCap:config.dailyTurnoverCap,slippageBps:50,intervalMs:60000});
}
paper.setInferenceProvider(async(s,q)=>{
 const r=api.agents.strategies.verify(s);await new Promise(resolve=>setTimeout(resolve,700));
 return infer(s,q,async url=>String(url).endsWith('/models')?new Response(JSON.stringify({data:[{id:s.agent.modelId}]})):new Response(JSON.stringify({model:s.agent.modelId,choices:[{finish_reason:'stop',message:{content:JSON.stringify({action:'HOLD',quoteUnits:'0',reason:'Named browser QA fixture: market does not meet saved entry conditions.'})}}]})),{strategyVersion:{id:r.id,commitment:r.commitment}});
});
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../app',import.meta.url)),plugins:[react(),tailwind(),{name:'memory-console-qa',configureServer(s){s.middlewares.use((req,res,next)=>void api.handle(req,res,next));}}],server:{host:'127.0.0.1',port:5199,strictPort:true}});
await server.listen();console.log('In-memory console browser fixture ready at http://127.0.0.1:5199/console');
const stop=async()=>{api.close();await server.close();process.exit(0);};process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
