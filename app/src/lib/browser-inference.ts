/// <reference path="../vite-env.d.ts" />
import type { Wllama } from '@wllama/wllama/esm/wllama.js';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import { parseProposal, proposalRequest, type ModelDecision } from '../../../near-demo/model.js';
import type { AgentManifest } from '../../../near-demo/public-types.js';
import { lastModelDirectory, scanModelDirectory } from './browser-models.js';

let loaded: { checksum: string; model: Wllama } | undefined;

export async function prepareBrowserModel(manifest: AgentManifest, modelId: string) {
  if (manifest.inference.runtime !== 'llama.cpp') {
    throw new Error('This agent uses an MLX classifier bundle. Browser inference currently supports GGUF models.');
  }
  if (loaded?.checksum === manifest.model.sha256 && loaded.model.isModelLoaded()) return loaded.model;
  const directory = await lastModelDirectory();
  if (!directory || await directory.queryPermission({ mode: 'read' }) !== 'granted') {
    throw new Error('Allow read access to your model folder in Create an agent, then try again.');
  }
  const models = await scanModelDirectory(directory);
  const selected = models.find(model => model.id === modelId) ??
    models.find(model => model.filename === manifest.model.filename && model.bytes === manifest.model.bytes);
  if (!selected?.openWeights) throw new Error('The registered GGUF file is missing from the permitted model folder.');
  if (loaded) {
    await loaded.model.exit();
    loaded = undefined;
  }
  const file = await selected.openWeights(manifest.model.sha256);
  const engine = await import('@wllama/wllama/esm/index.js') as unknown as { Wllama: typeof Wllama };
  const runtime = new engine.Wllama({ default: new URL(wasmUrl, location.origin).href }, { suppressNativeLog: true });
  try {
    const webGPU = await runtime.isSupportWebGPU();
    if (!webGPU && file.size > 2 * 1024 ** 3) throw new Error('WebGPU is required for this large GGUF file in Pump.');
    await runtime.loadModel([file], { n_ctx: manifest.inference.context, n_gpu_layers: webGPU ? 999 : 0 });
  } catch (error) {
    await runtime.exit().catch(() => {});
    const reason = error instanceof Error ? error.message : 'Runtime initialization failed.';
    throw new Error(`Could not load ${manifest.model.id} in Chrome. ${reason.slice(0, 150)}`);
  }
  loaded = { checksum: manifest.model.sha256, model: runtime };
  return runtime;
}

export function browserInference(runtime: Wllama, strategyVersion: { id: string; commitment: string }, signal: AbortSignal): typeof import('../../../near-demo/model.js').infer {
  return async (session, market, _fetcher, context): Promise<ModelDecision> => {
    const id = session.agent!.modelId;
    const request = proposalRequest(session, market, id, { ...context!, strategyVersion });
    const response = await runtime.createChatCompletion({
      messages: request.messages.map(message => ({ role: message.role as 'system' | 'user', content: message.content })),
      model: id, temperature: 0, max_tokens: 512,
      response_format: { type: 'json_schema', json_schema: { name: 'paper_trade', strict: true, schema: request.response_format.schema } },
      chat_template_kwargs: request.chat_template_kwargs, abortSignal: signal, stream: false,
    });
    const result = response.choices[0];
    const raw = result?.message.content;
    if (signal.aborted || response.choices.length !== 1 || result?.finish_reason !== 'stop' || typeof raw !== 'string' || raw.length > 131072) {
      throw new Error('The local model did not return a complete paper-trade decision.');
    }
    const proposal = parseProposal(JSON.parse(raw));
    if (proposal.reason.length > 240) throw new Error('Local model explanation exceeded the size limit.');
    return { id, request, raw, proposal, runtime: { engine: 'wllama', version: (runtime.constructor as typeof Wllama).getLibllamaVersion() } };
  };
}
