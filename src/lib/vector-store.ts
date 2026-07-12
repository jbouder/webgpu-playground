/**
 * In-memory vector store with cosine-similarity search. A flat brute-force
 * scan — plenty for a playground (thousands of chunks). No heavy vector DB.
 *
 * Pure and framework-agnostic — unit-testable without a browser or GPU.
 */

export interface SearchResult {
  index: number
  text: string
  score: number
}

interface StoredItem {
  index: number
  text: string
  vector: Float32Array
  norm: number
}

function l2norm(v: Float32Array): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i]
  return Math.sqrt(sum)
}

function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let sum = 0
  for (let i = 0; i < n; i++) sum += a[i] * b[i]
  return sum
}

export class VectorStore {
  private items: StoredItem[] = []

  get size(): number {
    return this.items.length
  }

  add(index: number, text: string, vector: Float32Array): void {
    this.items.push({ index, text, vector, norm: l2norm(vector) || 1 })
  }

  addMany(entries: { index: number; text: string; vector: Float32Array }[]): void {
    for (const e of entries) this.add(e.index, e.text, e.vector)
  }

  /** Top-K by cosine similarity, highest first. */
  search(query: Float32Array, topK = 5): SearchResult[] {
    const qNorm = l2norm(query) || 1
    const scored = this.items.map((it) => ({
      index: it.index,
      text: it.text,
      score: dot(query, it.vector) / (qNorm * it.norm),
    }))
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, Math.max(0, topK))
  }

  clear(): void {
    this.items = []
  }
}
