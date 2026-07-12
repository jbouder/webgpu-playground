import type { Demo } from '../../gpu/types'
import type { SearchResult } from '../../lib/vector-store'
import { SemanticSearchEngine, type ProgressInfo } from '../semantic-search'
import type { ChatMessage, LlmRequest, LlmResponse } from './llm-protocol'

// Small instruct models, smallest download first. Exposed so the Panel can
// offer a swap and cold-start cost is a deliberate choice, not a surprise.
export interface ModelOption {
  id: string
  label: string
  size: string
}
export const LLM_MODELS: ModelOption[] = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 1B', size: '~0.9 GB' },
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 0.5B (fastest)', size: '~0.5 GB' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B (best)', size: '~1.6 GB' },
]
export const DEFAULT_LLM = LLM_MODELS[0].id

const TOP_K = 4

const SYSTEM_PROMPT = `You are a helpful assistant answering questions about a document.
Use ONLY the numbered context passages to answer. If the answer is not contained in the
context, say you don't know rather than guessing. Keep answers concise and cite the passages
you used by their number, like [1] or [2].`

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

interface StreamHandlers {
  onToken: (text: string) => void
  resolve: (v: { text: string; stats: string }) => void
  reject: (e: Error) => void
}

/**
 * React-free client for the WebLLM worker. Unlike the embedding client,
 * generation streams: `generate` resolves only on `done`, forwarding each
 * delta to `onToken` along the way.
 */
class LlmClient {
  private worker: Worker
  private nextId = 1
  private pending = new Map<number, StreamHandlers>()
  onProgress: ((info: ProgressInfo) => void) | null = null

  constructor() {
    this.worker = new Worker(new URL('./llm.worker.ts', import.meta.url), {
      type: 'module',
      name: 'llm-worker',
    })
    this.worker.onmessage = (e: MessageEvent<LlmResponse>) => this.handle(e.data)
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'LLM worker crashed')
      this.pending.forEach((p) => p.reject(err))
      this.pending.clear()
    }
  }

  private handle(msg: LlmResponse) {
    if (msg.type === 'progress') {
      this.onProgress?.({ message: msg.message, progress: msg.progress })
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    if (msg.type === 'token') {
      p.onToken(msg.text)
    } else if (msg.type === 'loaded') {
      this.pending.delete(msg.id)
      p.resolve({ text: '', stats: '' })
    } else if (msg.type === 'done') {
      this.pending.delete(msg.id)
      p.resolve({ text: msg.text, stats: msg.stats })
    } else if (msg.type === 'error') {
      this.pending.delete(msg.id)
      p.reject(new Error(msg.message))
    }
  }

  private send(req: DistributiveOmit<LlmRequest, 'id'>, onToken: StreamHandlers['onToken']) {
    const id = this.nextId++
    return new Promise<{ text: string; stats: string }>((resolve, reject) => {
      this.pending.set(id, { onToken, resolve, reject })
      this.worker.postMessage({ ...req, id } as LlmRequest)
    })
  }

  load(model: string): Promise<void> {
    return this.send({ type: 'load', model }, () => {}).then(() => {})
  }

  generate(messages: ChatMessage[], onToken: (t: string) => void) {
    return this.send({ type: 'generate', messages }, onToken)
  }

  /** Abort the in-flight generation, if any (fire-and-forget). */
  interrupt(): void {
    this.worker.postMessage({ id: 0, type: 'interrupt' } as LlmRequest)
  }

  dispose(): void {
    this.pending.clear()
    this.worker.terminate()
  }
}

export interface AnswerOptions {
  onSources?: (sources: SearchResult[]) => void
  onToken?: (text: string) => void
}

/**
 * RAG engine: composes Phase 4's retrieval (embedding worker + vector store)
 * with a WebLLM generation worker. `answer` retrieves the top chunks for a
 * query, packs them as grounded context, and streams the model's reply.
 */
export class RagEngine {
  private retrieval = new SemanticSearchEngine()
  private llm = new LlmClient()

  onEmbedProgress: ((info: ProgressInfo) => void) | null = null
  onLlmProgress: ((info: ProgressInfo) => void) | null = null

  constructor() {
    this.retrieval.onProgress = (p) => this.onEmbedProgress?.(p)
    this.llm.onProgress = (p) => this.onLlmProgress?.(p)
  }

  /** Load the embedding model (small; retrieval side). */
  loadEmbedder(): Promise<{ dims: number; backend: string }> {
    return this.retrieval.load()
  }

  /** Load the generation model (large; the ~1 GB download). */
  loadLlm(model: string = DEFAULT_LLM): Promise<void> {
    return this.llm.load(model)
  }

  indexText(text: string): Promise<{ chunks: number }> {
    return this.retrieval.indexText(text)
  }

  get size(): number {
    return this.retrieval.size
  }

  clear(): void {
    this.retrieval.clear()
  }

  /** Retrieve context for `query`, then stream a grounded answer. */
  async answer(query: string, opts: AnswerOptions = {}): Promise<{ text: string; stats: string }> {
    const sources = await this.retrieval.search(query, TOP_K)
    opts.onSources?.(sources)

    const context = sources.map((s, i) => `[${i + 1}] ${s.text}`).join('\n\n')
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Context passages:\n${context}\n\nQuestion: ${query}` },
    ]
    return this.llm.generate(messages, opts.onToken ?? (() => {}))
  }

  interrupt(): void {
    this.llm.interrupt()
  }

  dispose(): void {
    this.retrieval.dispose()
    this.llm.dispose()
  }
}

// DOM-primary demo: no canvas render loop. WebGPU is exercised as the
// *inference* backend for both retrieval (transformers.js) and generation
// (WebLLM), each inside its own Web Worker.
export const ragLlmDemo: Demo = {
  id: 'rag-llm',
  title: 'RAG Chat',
  description:
    'Retrieval-augmented chat, fully in-browser. transformers.js embeds your document (Phase 4 retrieval) and WebLLM generates a grounded answer from the retrieved passages — both running on WebGPU inside Web Workers, no server.',
}
