import {verifyDirectoryRecord} from '../../near-demo/directory/verify.js';

const directory='https://explorer-plasma-lone-macro.trycloudflare.com';
const replacement='https://dealers-freely-armstrong-migration.trycloudflare.com';
const rpc='https://test.rpc.fastnear.com';
async function json(url:string,options:RequestInit={}){
 const response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Remote endpoint returned HTTP '+response.status);
 return response.json() as Promise<any>;
}
export default {
 async fetch(request:Request){
  const url=new URL(request.url);
  const send=(value:unknown,status=200)=>new Response(JSON.stringify(value,null,2),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'}});
  if(!['GET','POST'].includes(request.method))return send({error:'Read-only verification service.'},405);
  if(url.pathname==='/')return send({schema:'PUMP-REMOTE-VERIFIER-v1',network:'testnet',directory,check:'/verify?agent=public-agent-id',purpose:'Independently verify a public runner publication, wallet ownership and strategy journal on a separate cloud host.'});
  if(url.pathname!=='/verify'&&url.pathname!=='/verify-checkpoint')return send({error:'Route unavailable.'},404);
  if(url.pathname==='/verify-checkpoint'&&request.method!=='POST'||url.pathname==='/verify'&&request.method!=='GET')return send({error:'Unsupported verification request.'},405);
  const id=url.searchParams.get('agent');
  if(!id||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))return send({error:'A public agent UUID is required.'},400);
  try{
   let input:any,source=directory;
   if(url.pathname==='/verify-checkpoint'){
    if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new Error('A JSON checkpoint is required.');
    const reader=request.body?.getReader();if(!reader)throw new Error('Checkpoint unavailable.');
    const parts:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2*1024*1024){await reader.cancel();throw new Error('Checkpoint exceeds 2 MB.');}parts.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}input=JSON.parse(new TextDecoder().decode(bytes));
    source=input?.proof?.ownerAuthorization?.challenge?.origin;if(![directory,replacement].includes(source))throw new Error('Unapproved staging source.');
   }else input=await json(directory+'/agents/'+id);
   const record=verifyDirectoryRecord(input,source);
   if(record.entry.agent.id!==id)throw new Error('Checkpoint belongs to a different agent.');
   const owner=record.proof.ownerAuthorization.signed;
   const response=await json(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'pump-remote-verifier',method:'query',params:{request_type:'view_access_key',finality:'final',account_id:owner.accountId,public_key:owner.publicKey}})});
   if(response.error||response.result?.permission!=='FullAccess')throw new Error('The claimed owner key is not a current NEAR full-access key.');
   return send({schema:'PUMP-REMOTE-VERIFICATION-v1',valid:true,network:'testnet',checkedAt:new Date().toISOString(),directory:source,transport:url.pathname==='/verify-checkpoint'?'submitted-public-checkpoint':'direct-directory-fetch',reportedAt:new Date(record.proof.reportedAt).toISOString(),checkpointAgeMs:Math.max(0,Date.now()-record.proof.reportedAt),agentId:id,owner:owner.accountId,ownerKeyPermission:'FullAccess',blockHeight:response.result.block_height,publicationHash:record.proof.payloadHash,runnerSignature:'verified',ownerSignature:'verified',strategies:record.entry.runs.map((run:any)=>({id:run.id,version:run.version,commitment:run.commitment,definitionCommitment:run.definition?'verified':'not supplied',head:run.session.head,sequence:run.session.sequence,decisions:run.activity.decisions,fills:run.activity.fills})),boundary:'This verifies publication attribution and evidence consistency. Historical model execution is not hardware-attested.'});
  }catch(error){return send({valid:false,error:error instanceof Error?error.message:'Remote verification failed.'},400);}
 }
};
