/**
 * The one normalized event shape every capture source emits. Sources are
 * framework-agnostic: each one takes an `emit` callback and returns a teardown
 * function that must fully restore whatever it patched or observed.
 *
 * Keep this free of React — the capture layer is portable to other demos.
 */

export type SignalSource = 'console' | 'network' | 'error' | 'performance' | 'react'

export type SignalLevel = 'debug' | 'info' | 'warn' | 'error'

export interface SignalEvent {
  /** Monotonic id assigned by the bus, unique within a session. */
  id: number
  source: SignalSource
  level: SignalLevel
  /** Human-readable one-liner; the primary text the pipeline reduces. */
  message: string
  /** performance.now() at capture time (ms). */
  ts: number

  // ---- Network-only fields ----
  method?: string
  url?: string
  status?: number
  /** Request duration in ms. */
  durationMs?: number
  /** Response transfer size in bytes, when the browser reports it. */
  sizeBytes?: number
  /** Request headers we saw go out (used by the redaction demo). */
  headers?: Record<string, string>

  // ---- Error-only fields ----
  /** Raw stack string, parsed later by the stack-frame reduction stage. */
  stack?: string

  // ---- Performance-only fields ----
  /** e.g. 'longtask' | 'LCP' | 'CLS'. */
  metric?: string
  /** Numeric value for the metric (ms for timings, unitless for CLS). */
  value?: number
}

/** A source's install function: wire `emit`, return a teardown thunk. */
export type Emit = (event: Omit<SignalEvent, 'id'>) => void
export type Teardown = () => void
export type CaptureSource = (emit: Emit) => Teardown
