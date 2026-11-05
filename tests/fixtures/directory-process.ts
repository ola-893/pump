// Disposable protocol wallets and databases for cross-process acceptance only.
import {createServer} from 'node:http';
import {once} from 'node:events';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {KeyPair,KeyPairSigner} from 'near-api-js';
import {DemoStore} from '../../near-demo/store.js';
import {PaperDemo} from '../../near-demo/service.js';
import {PumpDirectory} from '../../near-demo/directory/service.js';
import {directoryHandler} from '../../near-demo/directory/server.js';
import {DirectoryRunner} from '../../near-demo/directory/runner.js';
import {directoryFixture} from './near-directory.js';

const [role,folder,remote='',owner='']=process.argv.slice(2);
const store=new DemoStore(join(folder,'state.sqlite'));
const keys=new Map<string,string>();
const permission=async(account:string,key:string)=>keys.get(account)===key?'FullAccess':'UnknownKey';
let directory:PumpDirectory;
let server:ReturnType<typeof createServer>|undefined;
let runner:DirectoryRunner|undefined;
let paper:PaperDemo|undefined;
let entry:any;
let wallet:ReturnType<typeof KeyPair.fromRandom>|undefined;
if(role==='hub'){
 server=createServer((req,res)=>void directoryHandler(directory,new Set())(req,res));
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin='http://127.0.0.1:'+(server.address() as any).port;
 directory=new PumpDirectory(store.db,origin,permission);
 process.send?.({ready:true,origin});
}else{
 directory=new PumpDirectory(store.db,remote,permission);
 paper=new PaperDemo(store);
 if(role==='runner'){
  const file=join(folder,'fixture.json');
  if(!existsSync(file))writeFileSync(file,JSON.stringify({wallet:KeyPair.fromRandom('ed25519').toString(),entry:directoryFixture(owner)}),{mode:0o600});
  const saved=JSON.parse(readFileSync(file,'utf8'));wallet=KeyPair.fromString(saved.wallet);entry=saved.entry;
  if(!store.list().length)store.create({...entry.histories[entry.runs[0].id].session,config:{...entry.runs[0].config,endpoint:'http://127.0.0.1:9999/v1'}});
 }
 const agents={strategies:{read:()=>entry.runs[0].definition},paper,records:()=>entry?[entry.agent]:[],visibility:()=>entry?.agent.visibility,
  publicStatus:()=>({agents:entry?.agent.visibility==='public'?[entry.agent]:[],strategyRuns:entry?.agent.visibility==='public'?entry.runs:[]})};
 runner=new DirectoryRunner(agents as any,{list:()=>[]} as any,directory,remote,join(folder,'runner-keys'));
 process.send?.({ready:true,owner,publicKey:wallet?.getPublicKey().toString(),agentId:entry?.agent.id,sessionId:entry?.runs[0].sessionId});
}
async function command(action:string,data:any){
 if(action==='setKey'){keys.set(data.owner,data.key);return true;}
 if(action==='authorize'||action==='revoke'){
  const challenge=await runner!.challenge(owner,action==='authorize'?'grant':'revoke');
  const signed=await KeyPairSigner.fromSecretKey(wallet!.toString()).signNep413Message(owner,{message:challenge.message,nonce:Buffer.from(challenge.nonce,'base64'),recipient:challenge.recipient});
  await runner!.authorize(challenge.id,{accountId:owner,publicKey:signed.publicKey.toString(),signature:Buffer.from(signed.signature).toString('base64')});
  return runner!.status();
 }
 if(action==='publish')return runner!.publish(owner);
 if(action==='private'){entry.agent.visibility='private';return runner!.publish(owner);}
 if(action==='catalog')return runner!.catalog();
 if(action==='read')return runner!.read(data.id);
 if(action==='sessions')return store.list().map(s=>s.id);
 if(action==='stop'){
  runner?.close();paper?.close();if(server){server.close();await once(server,'close');}store.close();process.disconnect?.();return true;
 }
 throw new Error('Unknown fixture command.');
}
let pending=Promise.resolve();
process.on('message',(m:any)=>{pending=pending.then(async()=>{
 try{const value=await command(m.action,m.data);if(process.connected)process.send?.({id:m.id,value});}
 catch(error){process.send?.({id:m.id,error:error instanceof Error?error.message:String(error)});}
});});
