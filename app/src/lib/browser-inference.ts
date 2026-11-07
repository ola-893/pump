/// <reference path="../vite-env.d.ts" />
import type { Wllama } from '@wllama/wllama/esm/wllama.js';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';
import { parseProposal, type ModelDecision } from '../../../near-demo/model.js';
import type { AgentManifest } from '../../../near-demo/public-types.js';
import { lastModelDirectory, ModelFolderError, scanModelDirectory } from './browser-models.js';
import { BrowserRuntimeCache, loadBrowserRuntime, runtimeDiagnostics } from './browser-runtime.js';
import { browserProposalRequest } from './browser-proposal.js';
import type { ReportInferenceProgress } from './browser-inference-progress.js';

const runtimes=new BrowserRuntimeCache<Wllama>();
let diagnostics=runtimeDiagnostics();

export async function prepareBrowserModel(manifest: AgentManifest, modelId: string, signal: AbortSignal, progress: ReportInferenceProgress) {
  signal.throwIfAborted();
  if (manifest.inference.runtime !== 'llama.cpp') {
    throw new Error('This agent uses an MLX classifier bundle. Browser inference currently supports GGUF models.');
  }
  const loaded=runtimes.get(manifest.model.sha256);
  if(loaded)return loaded;
  progress('scanning');
  const file = await openRegisteredModel(manifest, modelId, signal, progress);
  await runtimes.clear();
  signal.throwIfAborted();
  progress('loading');
  const engine = await import('@wllama/wllama/esm/index.js') as unknown as { Wllama: typeof Wllama };
  const loadedModel = await loadBrowserRuntime(
    logger => new engine.Wllama({ default: new URL(wasmUrl, location.origin).href }, { logger }),
    file, { id: manifest.model.id, context: manifest.inference.context }, signal, () => progress('retrying'),
  );
  const { runtime } = loadedModel;
  diagnostics = loadedModel.diagnostics;
  runtimes.save(manifest.model.sha256,runtime);
  return runtime;
}

async function openRegisteredModel(manifest: AgentManifest, modelId: string, signal: AbortSignal, progress: ReportInferenceProgress) {
  const directory = await lastModelDirectory(manifest.model.sha256);
  try {
    if (!directory || await directory.queryPermission({ mode: 'read' }) !== 'granted') {
      throw new ModelFolderError('Chrome lost read access to the model folder. Choose it again to continue.');
    }
    const models = await scanModelDirectory(directory, signal);
    const selected = models.find(model => model.id === modelId) ??
      models.find(model => model.filename === manifest.model.filename && model.bytes === manifest.model.bytes);
    if (!selected?.openWeights) throw new ModelFolderError(`Choose the folder containing ${manifest.model.filename}.`);
    return await selected.openWeights(manifest.model.sha256, signal, completed=>progress('verifying',completed,selected.bytes));
  } catch (error) {
    if (error instanceof DOMException && ['NotAllowedError', 'NotFoundError', 'SecurityError'].includes(error.name)) {
      throw new ModelFolderError('Chrome couldn’t read the registered model. Choose its folder to try again.');
    }
    throw error;
  }
}

export function browserInference(runtime: Wllama, strategyVersion: { id: string; commitment: string }, signal: AbortSignal, progress: ReportInferenceProgress): typeof import('../../../near-demo/model.js').infer {
  return async (session, market, _fetcher, context): Promise<ModelDecision> => {
    const id = session.agent!.modelId;
    const request = browserProposalRequest(session, market, strategyVersion, context);
    progress('evaluating');
    const response = await runtimes.evaluate(runtime,()=>runtime.createChatCompletion({
      messages: request.messages.map(message => ({ role: message.role as 'system' | 'user', content: message.content })),
      model: id, temperature: 0, max_tokens: 512,
      response_format: { type: 'json_schema', json_schema: { name: 'paper_trade', strict: true, schema: request.response_format.schema } },
      chat_template_kwargs: request.chat_template_kwargs, abortSignal: signal, stream: false,
    })).catch(error=>{
      if(signal.aborted)throw new Error('The paper decision was stopped before completion.');
      throw new Error(`Browser model evaluation failed. No order was placed. ${diagnostics.reason(error).slice(0,300)}`);
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
