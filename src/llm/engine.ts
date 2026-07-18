import {
  CreateMLCEngine,
  CreateWebWorkerMLCEngine,
  type MLCEngineInterface,
} from '@mlc-ai/web-llm'
import { ANALYSIS_SCHEMA_STRING } from './schema'
import type { ChatMessage } from './prompt'

export interface LoadProgress {
  message: string
  /** 0..1, or -1 when indeterminate. */
  progress: number
}

/** Runtime metrics surfaced in the telemetry overlay. */
export interface Metrics {
  decodeTokensPerSec?: number
  prefillTokensPerSec?: number
  ttftMs?: number
  completionTokens?: number
  promptTokens?: number
}

export interface AnalyzeOptions {
  structured: boolean
  stream: boolean
  onToken?: (delta: string) => void
}

export interface AnalyzeResult {
  text: string
  metrics: Metrics
}

/**
 * Portable, React-free wrapper around WebLLM. It can host the engine either in
 * a Web Worker (default, off the main thread) or on the main thread — the
 * "Worker" runtime toggle. Switching mode or model tears down the old engine
 * and rebuilds; weights are cached (IndexedDB / Cache API) so the rebuild does
 * not re-download.
 */
export class ObservabilityLLM {
  private engine: MLCEngineInterface | null = null
  private worker: Worker | null = null
  private loadedModel = ''
  private loadedInWorker = true

  onProgress: ((p: LoadProgress) => void) | null = null

  get ready(): boolean {
    return this.engine !== null
  }

  get model(): string {
    return this.loadedModel
  }

  /** Load (or reload) `model`, in a worker or on the main thread. Idempotent
   *  when the requested model+mode already match. */
  async load(model: string, useWorker: boolean): Promise<void> {
    if (this.engine && this.loadedModel === model && this.loadedInWorker === useWorker) return

    await this.teardownEngine()

    const config = {
      initProgressCallback: (report: { text: string; progress: number }) =>
        this.onProgress?.({ message: report.text, progress: report.progress }),
    }

    if (useWorker) {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
        type: 'module',
        name: 'observability-llm',
      })
      this.engine = await CreateWebWorkerMLCEngine(this.worker, model, config)
    } else {
      this.engine = await CreateMLCEngine(model, config)
    }
    this.loadedModel = model
    this.loadedInWorker = useWorker
  }

  /** Run one analysis. Streams token deltas to `onToken` when `stream` is on;
   *  constrains output to the JSON schema when `structured` is on. */
  async analyze(messages: ChatMessage[], opts: AnalyzeOptions): Promise<AnalyzeResult> {
    if (!this.engine) throw new Error('Model not loaded')

    const responseFormat = opts.structured
      ? ({ type: 'json_object', schema: ANALYSIS_SCHEMA_STRING } as const)
      : undefined

    const started = performance.now()
    let ttftMs: number | undefined
    let full = ''
    const metrics: Metrics = {}

    if (opts.stream) {
      const stream = await this.engine.chat.completions.create({
        messages,
        stream: true,
        stream_options: { include_usage: true },
        temperature: 0.3,
        max_tokens: 400,
        response_format: responseFormat,
      })
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? ''
        if (delta) {
          if (ttftMs === undefined) ttftMs = performance.now() - started
          full += delta
          opts.onToken?.(delta)
        }
        if (chunk.usage) applyUsage(metrics, chunk.usage)
      }
    } else {
      const res = await this.engine.chat.completions.create({
        messages,
        stream: false,
        temperature: 0.3,
        max_tokens: 400,
        response_format: responseFormat,
      })
      full = res.choices[0]?.message?.content ?? ''
      ttftMs = performance.now() - started
      if (res.usage) applyUsage(metrics, res.usage)
      opts.onToken?.(full)
    }

    metrics.ttftMs = metrics.ttftMs ?? ttftMs
    return { text: full, metrics }
  }

  /** Abort the in-flight generation, if any. */
  interrupt(): void {
    this.engine?.interruptGenerate?.()
  }

  private async teardownEngine(): Promise<void> {
    try {
      await this.engine?.unload?.()
    } catch {
      // best-effort
    }
    this.worker?.terminate()
    this.worker = null
    this.engine = null
    this.loadedModel = ''
  }

  async dispose(): Promise<void> {
    await this.teardownEngine()
  }
}

interface UsageLike {
  completion_tokens?: number
  prompt_tokens?: number
  extra?: {
    decode_tokens_per_s?: number
    prefill_tokens_per_s?: number
    time_to_first_token_s?: number
  }
}

function applyUsage(metrics: Metrics, usage: UsageLike): void {
  metrics.completionTokens = usage.completion_tokens ?? metrics.completionTokens
  metrics.promptTokens = usage.prompt_tokens ?? metrics.promptTokens
  const extra = usage.extra
  if (extra) {
    metrics.decodeTokensPerSec = extra.decode_tokens_per_s ?? metrics.decodeTokensPerSec
    metrics.prefillTokensPerSec = extra.prefill_tokens_per_s ?? metrics.prefillTokensPerSec
    if (extra.time_to_first_token_s != null) metrics.ttftMs = extra.time_to_first_token_s * 1000
  }
}
