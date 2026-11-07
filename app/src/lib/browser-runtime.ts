import type { LoadModelParams } from '@wllama/wllama/esm/types/types.js';

export type RuntimeResource = { isModelLoaded():boolean; exit():Promise<void> };

/** A crashed WASM instance cannot serve a subsequent agent decision. */
export class BrowserRuntimeCache<T extends RuntimeResource> {
  private loaded?:{ checksum:string; runtime:T };
  get(checksum:string) {
    const loaded=this.loaded;
    return loaded?.checksum===checksum&&loaded.runtime.isModelLoaded()?loaded.runtime:undefined;
  }
  save(checksum:string,runtime:T) { this.loaded={checksum,runtime}; }
  async clear(runtime=this.loaded?.runtime) {
    if(!runtime)return;
    if(this.loaded?.runtime===runtime)this.loaded=undefined;
    await runtime.exit().catch(()=>{});
  }
  async evaluate<R>(runtime:T,operation:()=>Promise<R>) {
    try { return await operation(); }
    catch(error) { await this.clear(runtime);throw error; }
  }
}

/** Bound native diagnostics; prompts and responses are never added to this log. */
export function runtimeDiagnostics() {
  const lines:string[]=[];
  const record=(...args:unknown[])=>{
    for(const item of args)if(typeof item==='string'){
      const text=item.trim();
      if(text && /webgpu|gpu|ggml|abort|error|fail|alloc|memory|device|timed out/i.test(text)) {
        lines.push(text.slice(0,500));
        if(lines.length>12)lines.shift();
      }
    }
  };
  return {
    logger:{debug:()=>{},log:record,warn:record,error:record},
    reason(error:unknown) {
      const detail=[...lines].reverse().find(line=>/webgpu.*(?:fail|error|timed out|lost)|(?:alloc|out of memory|device lost)/i.test(line));
      return detail??(error instanceof Error?error.message:'Browser inference failed.');
    },
  };
}

type ModelRuntime = RuntimeResource & {
  isSupportWebGPU(): boolean;
  loadModel(files: Blob[], params: LoadModelParams): Promise<void>;
};

export async function loadBrowserRuntime<T extends ModelRuntime>(
  create: (logger: ReturnType<typeof runtimeDiagnostics>['logger']) => T,
  file: File,
  model: { id: string; context: number },
  signal: AbortSignal,
  onRetry: () => void,
) {
  let diagnostics = runtimeDiagnostics();
  let runtime = create(diagnostics.logger);
  // This 52-layer model needs GPU offload to fit inside wllama's WASM heap.
  // Reserve room on both devices by moving only a few layers off the GPU.
  const largeMuse = model.id === 'Muse-Glimmer-30B' && file.size >= 12 * 1024 ** 3;
  const settings: LoadModelParams = {
    n_ctx: model.context, n_parallel: 1, n_batch: 64, n_ubatch: 16,
    warmup: false, flash_attn: true, log_level: 3,
  };
  try {
    const webGPU = runtime.isSupportWebGPU();
    signal.throwIfAborted();
    if (!webGPU && file.size > 2 * 1024 ** 3) throw new Error('WebGPU is required for this large GGUF file in Pump.');
    await runtime.loadModel([file], {
      ...settings, n_gpu_layers: webGPU ? largeMuse ? 48 : 999 : 0,
      ...(webGPU && largeMuse ? { no_kv_offload: true } : {}),
    });
    signal.throwIfAborted();
  } catch (error) {
    const reason = diagnostics.reason(error);
    await runtime.exit().catch(() => {});
    signal.throwIfAborted();
    if (!largeMuse || !/queue wait.*timed out|buffer map wait.*timed out|device lost|out of memory/i.test(reason)) {
      throw new Error(`Could not load ${model.id} in Chrome. ${reason.slice(0, 300)}`);
    }
    onRetry();
    diagnostics = runtimeDiagnostics();
    runtime = create(diagnostics.logger);
    try {
      await runtime.loadModel([file], { ...settings, n_gpu_layers: 44, no_kv_offload: true, n_batch: 32, n_ubatch: 8 });
      signal.throwIfAborted();
    } catch (retryError) {
      await runtime.exit().catch(() => {});
      signal.throwIfAborted();
      throw new Error(`Chrome could not load ${model.id} with reduced GPU use. ${diagnostics.reason(retryError).slice(0, 300)}`);
    }
  }
  return { runtime, diagnostics };
}
