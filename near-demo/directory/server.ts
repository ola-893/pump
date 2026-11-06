import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {PumpDirectory} from './service.js';
export function directoryHandler(directory:PumpDirectory,origins:Set<string>,options:{trustCloudflare?:boolean;now?:()=>number}={}){
 const clients=new Map<string,{at:number;reads:number;writes:number}>();
 const now=options.now??Date.now;
 const accept=(req:IncomingMessage)=>{
  const at=now();
  for(const [key,value] of clients)if(at-value.at>=60000)clients.delete(key);
  const forwarded=req.headers['cf-connecting-ip'];
  const key=options.trustCloudflare&&typeof forwarded==='string'?forwarded:req.socket.remoteAddress??'unknown';
  if(!clients.has(key)&&clients.size>=1000)return false;
  const client=clients.get(key)??{at,reads:0,writes:0};clients.set(key,client);
  if(req.method==='POST')return ++client.writes<=30;
  return ++client.reads<=240;
 };
 const send=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 return async(req:IncomingMessage,res:ServerResponse)=>{
  if(!accept(req)){res.setHeader('Retry-After','60');send(res,429,{error:'Directory request limit reached. Try again in one minute.'});return;}
  const origin=req.headers.origin;if(origin&&!origins.has(origin)){send(res,403,{error:'This origin is not allowed.'});return;}
  if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Methods','GET, POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.writeHead(204);res.end();return;}
  const url=new URL(req.url??'/','http://directory.local');
  try{
   if(req.method==='GET'&&url.pathname==='/health'){send(res,200,{schema:'PUMP-PUBLIC-DIRECTORY-v1',network:'testnet',ok:true});return;}
   if(req.method==='GET'&&url.pathname==='/catalog'){send(res,200,directory.catalog(Number(url.searchParams.get('offset')),Number(url.searchParams.get('limit'))||24));return;}
   if(req.method==='GET'&&url.pathname==='/journal-agents'){send(res,200,directory.journals.catalog(Number(url.searchParams.get('offset'))));return;}
   if(req.method==='GET'&&url.pathname.startsWith('/journals/')){
    const strategy=url.searchParams.get('strategy')??undefined, before=url.searchParams.get('before');
    send(res,200,directory.journals.page(decodeURIComponent(url.pathname.slice(10)),strategy,before===null?undefined:Number(before)));return;
   }
   if(req.method==='GET'&&url.pathname.startsWith('/agents/')){send(res,200,directory.read(decodeURIComponent(url.pathname.slice(8))));return;}
   if(req.method!=='POST'||req.headers['content-type']?.split(';')[0]!=='application/json'){send(res,404,{error:'Directory route unavailable.'});return;}
   const chunks:Buffer[]=[];let size=0;for await(const part of req){size+=part.length;if(size>2*1024*1024)throw new Error('Publication exceeds 2 MB; publish fewer agents per batch.');chunks.push(Buffer.from(part));}
   const b=JSON.parse(Buffer.concat(chunks).toString());let result;
   if(url.pathname==='/challenge')result=directory.auth.challenge(b.account,b.runnerKey,b.action);
   else if(url.pathname==='/authorize')result=await directory.authorize(b.id,b.signed);
   else if(url.pathname==='/publish')result=directory.publish(b.payload,b.publicKey,b.signature);
   else if(url.pathname==='/journal-publish')result=directory.journals.publish(b.batch,b.publicKey,b.signature);
   else {send(res,404,{error:'Directory route unavailable.'});return;}
   send(res,200,result);
  }catch(error){const message=error instanceof Error?error.message:'Directory operation failed.';send(res,400,{error:message.includes('/Users/')?'Directory operation failed.':message});}
 };
}
if(process.argv[1]?.endsWith('/directory/server.ts')){
 const port=Number(process.env.PUMP_DIRECTORY_PORT??5198),origin=process.env.PUMP_DIRECTORY_ORIGIN??`http://127.0.0.1:${port}`;
 if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid directory port.');
 const path=resolve(process.env.PUMP_DIRECTORY_DB??'.local/pump-directory/catalog.sqlite');mkdirSync(dirname(path),{recursive:true,mode:0o700});const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
 const directory=new PumpDirectory(db,origin),origins=new Set((process.env.PUMP_DIRECTORY_CLIENT_ORIGINS??'http://127.0.0.1:5197').split(','));
 const handler=directoryHandler(directory,origins,{trustCloudflare:process.env.PUMP_DIRECTORY_TRUST_CLOUDFLARE==='1'});
 const server=createServer({requestTimeout:20000,headersTimeout:10000},(req,res)=>void handler(req,res));
 server.maxRequestsPerSocket=100;
 server.listen(port,process.env.PUMP_DIRECTORY_HOST??'127.0.0.1',()=>console.log(`Pump shared directory: ${origin}`));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>db.close()));
}
