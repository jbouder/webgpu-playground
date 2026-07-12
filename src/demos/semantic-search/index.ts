import { chunkText } from '../../lib/chunk'
import { VectorStore, type SearchResult } from '../../lib/vector-store'
import type { Demo } from '../../gpu/types'
import type { WorkerRequest, WorkerResponse } from './protocol'

export const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
const EMBED_BATCH = 32

export interface ProgressInfo {
  message: string
  progress: number
}

// Omit that distributes over the WorkerRequest union so each variant keeps its
// own fields (a plain Omit<Union, 'id'> collapses to the shared keys only).
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

/**
 * React-free engine: owns the embedding worker, the vector store, and the
 * chunk→embed→store→query pipeline. The Panel component drives it.
 */
export class SemanticSearchEngine {
  readonly model: string
  private worker: Worker
  private store = new VectorStore()
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

  /** Called with model-download / embedding progress. */
  onProgress: ((info: ProgressInfo) => void) | null = null

  constructor(model: string = DEFAULT_MODEL) {
    this.model = model
    this.worker = new Worker(new URL('./embed.worker.ts', import.meta.url), {
      type: 'module',
      name: 'embed-worker',
    })
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data)
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Worker crashed')
      this.pending.forEach((p) => p.reject(err))
      this.pending.clear()
    }
  }

  private handle(msg: WorkerResponse) {
    if (msg.type === 'progress') {
      this.onProgress?.({ message: msg.message, progress: msg.progress })
      return
    }
    const p = this.pending.get(msg.id)
    if (!p) return
    this.pending.delete(msg.id)
    if (msg.type === 'error') p.reject(new Error(msg.message))
    else if (msg.type === 'loaded') p.resolve({ dims: msg.dims, backend: msg.backend })
    else if (msg.type === 'embeddings') p.resolve(msg.vectors)
  }

  private call<T>(req: DistributiveOmit<WorkerRequest, 'id'>): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker.postMessage({ ...req, id } as WorkerRequest)
    })
  }

  load(): Promise<{ dims: number; backend: string }> {
    return this.call({ type: 'load', model: this.model })
  }

  private embed(texts: string[]): Promise<number[][]> {
    return this.call({ type: 'embed', texts })
  }

  /** Chunk a document, embed the chunks in batches, and store them. */
  async indexText(text: string): Promise<{ chunks: number }> {
    const chunks = chunkText(text)
    if (chunks.length === 0) return { chunks: 0 }

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH)
      const vectors = await this.embed(batch.map((c) => c.text))
      batch.forEach((c, j) => this.store.add(c.index, c.text, new Float32Array(vectors[j])))
      this.onProgress?.({
        message: `Embedding chunks ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}`,
        progress: Math.min(i + EMBED_BATCH, chunks.length) / chunks.length,
      })
    }
    return { chunks: chunks.length }
  }

  async search(query: string, topK = 5): Promise<SearchResult[]> {
    const [vector] = await this.embed([query])
    return this.store.search(new Float32Array(vector), topK)
  }

  get size(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  dispose(): void {
    this.pending.clear()
    this.worker.terminate()
  }
}

// DOM-primary demo: no canvas render loop. The Panel (registered separately)
// owns the engine lifecycle. WebGPU is exercised here as the *inference*
// backend inside the worker, not the render pipeline.
export const semanticSearchDemo: Demo = {
  id: 'semantic-search',
  title: 'Semantic Search',
  description:
    'Client-side semantic search: paste a document, and transformers.js embeds it in a Web Worker (WebGPU backend). Queries retrieve the most relevant chunks by cosine similarity — fully local, no server.',
}
