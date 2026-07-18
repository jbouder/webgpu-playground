import type { SignalEvent, SignalLevel, SignalSource } from '../capture/types'

/** One parsed line of a stack trace. */
export interface StackFrame {
  fn: string
  file: string
  line?: number
  col?: number
}

/**
 * A group of near-identical events collapsed to a single row with a count.
 * `sample` is the representative event; `signature` is the key events were
 * grouped by (post-normalization when that stage is on).
 */
export interface Cluster {
  id: string
  signature: string
  source: SignalSource
  /** Highest severity seen in the cluster. */
  level: SignalLevel
  count: number
  sample: SignalEvent
  /** Present when stack-frame extraction ran and the sample had a stack. */
  frames?: StackFrame[]
}

/** Output of the whole pipeline — what the digest panel and the LLM consume. */
export interface Digest {
  clusters: Cluster[]
  /** Events that entered the pipeline. */
  totalEvents: number
  /** Events kept after the sampling cap. */
  keptEvents: number
  /** Events dropped by the sampling cap (totalEvents - keptEvents). */
  droppedBySample: number
}

/** Which stages are enabled — each maps to a toggle in the control rail. */
export interface ReductionConfig {
  redact: boolean
  sample: boolean
  sampleCap: number
  normalize: boolean
  dedupe: boolean
  stackframes: boolean
}

export type { SignalEvent }
