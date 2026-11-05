import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ArtifactHasher } from './artifact-hasher.js';
import { fileURLToPath } from 'node:url';
import { artifactStamp,isBundle,readBundle } from './model-bundle.js';
import { homedir } from 'node:os';
import { join,dirname } from 'node:path';
/** Owns one dedicated loopback process; never kills an operator's inference server. */
export class LocalRuntime {
  readonly endpoint='http://127.0.0.1:8093/v1';
  private child?:ChildProcess;
  private current='';
  private tail:Promise<unknown>=Promise.resolve();
  private closed=false;
  private hasher=new ArtifactHasher();
  private evidence:Record<string,unknown>={};
  describe(){return this.evidence;}
  state:{modelId:string|null;phase:string}={modelId:null,phase:'idle'};
  async use<T>(model:{id:string;path:string;stamp:string},run:()=>Promise<T>):Promise<T>{
    const next=this.tail.then(async()=>{
      if(this.closed)throw new Error('Local runtime is shutting down.');
      if(await artifactStamp(model.path)!==model.stamp)throw new Error('Registered weights changed. Register the new model before running it.');
      if(this.current!==model.id||!this.child||this.child.exitCode!==null){
        await this.stop();this.state={modelId:model.id,phase:'loading'};
        let occupied=false;try{await fetch(this.endpoint.replace('/v1','/health'),{signal:AbortSignal.timeout(1000)});occupied=true;}catch{}
        if(occupied)throw new Error('Port 8093 is already occupied. Stop that server or change its port before using managed inference.');
        // No application secrets or signing configuration are inherited by the model process.
        const classifier=isBundle(model.path);
        const bundle=classifier?await readBundle(model.path):null;
        const child=classifier?spawn(join(homedir(),'.local/share/pump/runtimes/clef-mlx/bin/python'),[fileURLToPath(new URL('./clef-server.py',import.meta.url)),'--bundle',model.path,'--alias',model.id,'--port','8093'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1',TOKENIZERS_PARALLELISM:'false',PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','ignore','pipe']}):spawn('/opt/homebrew/bin/llama-server',['--model',model.path,'--alias',model.id,'--host','127.0.0.1','--port','8093','--ctx-size','4096','--parallel','1','--n-gpu-layers','99','--batch-size','128','--ubatch-size','64','--cache-type-k','q8_0','--cache-type-v','q8_0','--flash-attn','on','--no-webui','--reasoning','auto','--reasoning-budget','64','--offline','--no-agent',...(/muse-glimmer/i.test(model.path)?['--chat-template-file',fileURLToPath(new URL('./muse-direct-answer.jinja',import.meta.url))]:[])],{env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR},stdio:['ignore','ignore','pipe']});
        this.child=child;const shutdown=()=>{child.kill('SIGTERM');};process.once('exit',shutdown);child.once('exit',()=>process.off('exit',shutdown));child.once('error',()=>process.off('exit',shutdown));let failed=false;child.on('error',()=>{failed=true;});child.stderr?.resume();
        const deadline=Date.now()+240000;
        for(;;){
          if(this.closed||failed||child.exitCode!==null)throw new Error('Local model could not load. Check free memory and the installed inference runtime.');
          try{const r=await fetch(this.endpoint.replace('/v1','/health'),{signal:AbortSignal.timeout(2000)});if(r.ok)break;}catch{}
          if(Date.now()>deadline){await this.stop();throw new Error('Local model loading exceeded four minutes.');}
          await new Promise(r=>setTimeout(r,500));
        }
        if(classifier){const health=await (await fetch(this.endpoint.replace('/v1','/health'),{signal:AbortSignal.timeout(5000)})).json() as any;if(health.model!==model.id||health.path!==await realpath(dirname(model.path))||health.runtime!=='clef-mlx')throw new Error('Classifier loaded a different artifact.');this.evidence={version:'PUMP-CLEF-MLX-RUNTIME-v1',...health,repository:bundle!.repository,revision:bundle!.revision,context:4096,output:'Fixed-choice scores; no generated explanation',evidence:'Local process metadata; no hardware attestation'};}else{
        const props=await (await fetch(this.endpoint.replace('/v1','/props'),{signal:AbortSignal.timeout(5000)})).json() as any;
        if(props.model_alias!==model.id||await realpath(props.model_path)!==await realpath(model.path))throw new Error('Managed inference loaded a different artifact.');
        const binary=await this.hasher.hash('/opt/homebrew/bin/llama-server');
        this.evidence={version:'PUMPCOIN-LOCAL-RUNTIME-v1',build:String(props.build_info),binarySHA256:binary.sha256,chatTemplateSHA256:createHash('sha256').update(String(props.chat_template)).digest('hex'),template:/muse-glimmer/i.test(model.path)?'Muse direct-answer recipient prefill':'Embedded model template',context:4096,parallel:1,batch:128,microbatch:64,keyCache:'q8_0',valueCache:'q8_0',reasoningBudget:64,evidence:'local process and server metadata; no hardware attestation'};
        }
        this.current=model.id;
      }
      this.state={modelId:model.id,phase:'inference'};
      try{const result=await run();if(await artifactStamp(model.path)!==model.stamp)throw new Error('Registered weights changed during inference. No additional fill is accepted.');return result;}finally{this.state={modelId:model.id,phase:'ready'};}
    });
    this.tail=next.catch(()=>{});return next;
  }
  async stop(){const c=this.child;this.child=undefined;this.current='';if(c&&c.pid&&c.exitCode===null){const exited=once(c,'exit').catch(()=>{});c.kill('SIGTERM');const timeout=setTimeout(()=>c.kill('SIGKILL'),5000);await exited;clearTimeout(timeout);}this.state={modelId:null,phase:'idle'};}
  async close(){this.closed=true;await this.stop();}
}
