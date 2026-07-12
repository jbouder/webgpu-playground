/**
 * Document chunking for retrieval. Sentence-aware: text is split into
 * sentences, then greedily packed into ~chunkSize-character windows with a
 * configurable sentence overlap so adjacent chunks share context.
 *
 * Pure and framework-agnostic — unit-testable without a browser or GPU.
 */

export interface Chunk {
  index: number
  text: string
}

export interface ChunkOptions {
  /** Target maximum characters per chunk. */
  chunkSize?: number
  /** Sentences carried from the end of one chunk into the start of the next. */
  overlapSentences?: number
}

/** Split text into trimmed sentences (collapsing whitespace first). */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const parts = normalized.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g)
  if (!parts) return [normalized]
  return parts.map((s) => s.trim()).filter((s) => s.length > 0)
}

export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const { chunkSize = 600, overlapSentences = 1 } = options
  const sentences = splitSentences(text)
  if (sentences.length === 0) return []

  const chunks: Chunk[] = []
  let current: string[] = []
  let length = 0
  let index = 0

  const flush = () => {
    if (current.length === 0) return
    chunks.push({ index: index++, text: current.join(' ') })
    // Seed the next chunk with the trailing overlap sentences.
    const overlap = overlapSentences > 0 ? current.slice(-overlapSentences) : []
    current = overlap
    length = overlap.reduce((sum, s) => sum + s.length + 1, 0)
  }

  for (const sentence of sentences) {
    // If adding this sentence would overflow and we already have content, cut.
    if (length + sentence.length > chunkSize && current.length > 0) {
      flush()
    }
    current.push(sentence)
    length += sentence.length + 1
  }
  // Final chunk (avoid emitting a chunk that's purely leftover overlap).
  if (current.length > 0) {
    chunks.push({ index: index++, text: current.join(' ') })
  }
  return chunks
}
