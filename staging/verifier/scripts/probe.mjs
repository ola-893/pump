import {writeFileSync,readFileSync} from 'node:fs';
const endpoint=new URL(process.argv[2]??'/','https://pump-testnet-verifier-20261103.pinkmelon512.chatgpt.site');
if(endpoint.origin!=='https://pump-testnet-verifier-20261103.pinkmelon512.chatgpt.site')throw new Error('Unexpected service origin.');
process.stdin.setRawMode(true);
process.stdout.write('Ready for private service credential on stdin\n');
let input='';
const token=await new Promise(resolve=>process.stdin.on('data',chunk=>{
 input+=chunk.toString();
 if(/[\r\n]/.test(input)){
  process.stdin.setRawMode(false);process.stdin.pause();process.stdin.unref();
  try{resolve(JSON.parse(input.split(/[\r\n]/)[0]).token);}catch{throw new Error('Invalid service credential input.');}
 }
}));
try{
 const body=process.argv[4]?readFileSync(process.argv[4],'utf8'):undefined;
 const response=await fetch(endpoint,{method:body?'POST':'GET',body,headers:{'OAI-Sites-Authorization':'Bearer '+token,...(body?{'content-type':'application/json'}:{})},redirect:'error',signal:AbortSignal.timeout(40000)});
 const result=await response.json();
 console.log(JSON.stringify({status:response.status,...result},null,2));
 if(response.ok&&result.valid&&process.argv[3])writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n',{mode:0o600});
 if(!response.ok)process.exitCode=1;
}catch(error){console.error(error instanceof Error?error.message:'Remote verification failed.');process.exitCode=1;}
