// LLM generation worker: runs WebLLM (WebGPU backend) off the main thread so
// the ~1 GB model download and token generation never stall the UI. Streams
// tokens back as they're produced. One engine per worker; the model is loaded
// once and reused across generations.
import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm'
import type { LlmRequest, LlmResponse } from './llm-protocol'

// `self` is typed as Window under the DOM lib; cast for the worker postMessage
// signature without pulling in the conflicting webworker lib.
const post = (msg: LlmResponse) => (self as unknown as Worker).postMessage(msg)

let engine: MLCEngine | null = null
let loadedModel = ''
// Set while a generation is in flight so `interrupt` can abort it.
let generating = false

async function load(id: number, model: string) {
  if (engine && loadedModel === model) {
    post({ id, type: 'loaded', model })
    return
  }
  engine = await CreateMLCEngine(model, {
    initProgressCallback: (report) => {
      // report.progress is 0..1; report.text is a human-readable status line.
      post({ id, type: 'progress', message: report.text, progress: report.progress })
    },
  })
  loadedModel = model
  post({ id, type: 'loaded', model })
}

async function generate(id: number, messages: LlmRequest & { type: 'generate' }) {
  if (!engine) throw new Error('Model not loaded')
  generating = true
  let full = ''
  try {
    const stream = await engine.chat.completions.create({
      messages: messages.messages,
      stream: true,
      stream_options: { include_usage: true },
      temperature: 0.4,
      max_tokens: 512,
    })

    let stats = ''
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? ''
      if (delta) {
        full += delta
        post({ id, type: 'token', text: delta })
      }
      if (chunk.usage) {
        const u = chunk.usage as { extra?: { decode_tokens_per_s?: number } }
        const tps = u.extra?.decode_tokens_per_s
        if (typeof tps === 'number') stats = `${tps.toFixed(1)} tok/s`
      }
    }
    post({ id, type: 'done', text: full, stats })
  } finally {
    generating = false
  }
}

self.onmessage = async (e: MessageEvent<LlmRequest>) => {
  const req = e.data
  try {
    if (req.type === 'load') await load(req.id, req.model)
    else if (req.type === 'generate') await generate(req.id, req)
    else if (req.type === 'interrupt') {
      if (engine && generating) await engine.interruptGenerate()
    }
  } catch (err) {
    post({
      id: req.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
