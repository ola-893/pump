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
