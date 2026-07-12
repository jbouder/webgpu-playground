// Embedding worker: runs transformers.js (feature-extraction) off the main
// thread so model download + inference never stall the render loop. Prefers
// the WebGPU backend, falling back to wasm if the GPU path is unavailable.
import { pipeline, env } from '@huggingface/transformers'
import type { WorkerRequest, WorkerResponse } from './protocol'

// Fetch models from the HF hub (cached in the browser after first download).
env.allowLocalModels = false

// `self` is typed as Window under the DOM lib; cast for the worker postMessage
// signature (single-arg) without pulling in the conflicting webworker lib.
const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg)

// transformers.js pipeline instance (kept loosely typed — its generics are heavy).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null
let backend = 'unknown'

async function load(id: number, model: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const progress_callback = (p: any) => {
    const pct = typeof p?.progress === 'number' ? p.progress / 100 : -1
    const file = p?.file ? ` ${p.file}` : ''
    post({ id, type: 'progress', message: `${p?.status ?? 'loading'}${file}`, progress: pct })
  }

  try {
    extractor = await pipeline('feature-extraction', model, {
      device: 'webgpu',
      dtype: 'fp32',
      progress_callback,
    })
    backend = 'webgpu'
  } catch {
    // GPU path failed (unsupported model/precision) — fall back to wasm.
    extractor = await pipeline('feature-extraction', model, { progress_callback })
    backend = 'wasm'
  }

  // Probe output dimensionality with a throwaway embed.
  const probe = await extractor(['dimension probe'], { pooling: 'mean', normalize: true })
  const dims = probe.dims[probe.dims.length - 1] as number
  post({ id, type: 'loaded', dims, backend })
}

async function embed(id: number, texts: string[]) {
  if (!extractor) throw new Error('Model not loaded')
  const out = await extractor(texts, { pooling: 'mean', normalize: true })
  post({ id, type: 'embeddings', vectors: out.tolist() as number[][] })
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  try {
    if (req.type === 'load') await load(req.id, req.model)
    else if (req.type === 'embed') await embed(req.id, req.texts)
  } catch (err) {
    post({
      id: req.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
