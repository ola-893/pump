// Isolated browser fixture: no real wallet, model, registry writes or transactions.
import { createServer } from '../app/node_modules/vite/dist/node/index.js';
import react from '../app/node_modules/@vitejs/plugin-react/dist/index.js';
import tailwind from '../app/node_modules/@tailwindcss/vite/dist/index.mjs';
import { fileURLToPath } from 'node:url';
const connector = `
let account='', selections=0; const listeners=new Map();
const c={network:'testnet',on(e,f){if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e).add(f)},off(e,f){listeners.get(e)?.delete(f)},
async getConnectedWallet(){if(!account)throw new Error('No wallet selected');return {accounts:[{accountId:account}]}},
async connect(){account=++selections%2?'alice.testnet':'bob.testnet';listeners.get('wallet:signIn')?.forEach(f=>f())},
async disconnect(){account='';listeners.get('wallet:signOut')?.forEach(f=>f())},
async wallet(){throw new Error('Transactions disabled in wallet QA fixture')}};
export async function nearConnector(){return c}
export async function sendDemoPlan(){throw new Error('Transactions disabled in wallet QA fixture')}
`;
const registry={agents:[],vaults:[],strategyRuns:[],continuous:null,execution:{activeId:null,queued:[]},models:[],measurement:null,runtime:{modelId:null,phase:'idle'},comparisons:[],market:null};
const server=await createServer({configFile:false,root:fileURLToPath(new URL('../app',import.meta.url)),plugins:[
{name:'isolated-wallet-qa',enforce:'pre',load(id){if(id.replaceAll('\\','/').endsWith('/src/lib/near-demo-wallet.ts'))return connector},
transformIndexHtml(html){return html.replace('<body>','<body><div style="padding:10px;background:#503b16;color:white;text-align:center">ISOLATED WALLET QA · fictional accounts · transactions disabled</div>')},
configureServer(s){s.middlewares.use((req,res,next)=>{if(!req.url.startsWith('/api/near-demo/'))return next();res.setHeader('Content-Type','application/json');if(req.url==='/api/near-demo/status')return res.end(JSON.stringify({token:'isolated-qa',registry}));if(req.url==='/api/near-demo/models')return res.end(JSON.stringify({models:[]}));res.statusCode=400;res.end(JSON.stringify({error:'Mutations disabled in wallet QA fixture'}))})}},react(),tailwind()],server:{host:'127.0.0.1',port:5200,strictPort:true}});
await server.listen();console.log('Isolated wallet QA: http://127.0.0.1:5200/register');
const stop=async()=>{await server.close();process.exit(0)};process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
