import type { Metrics } from '../../../llm/engine'

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'

interface Props {
  status: ModelStatus
  progress: { message: string; value: number }
  metrics: Metrics
  contextTokens: number
  contextMax: number
  worker: boolean
}

function stat(label: string, value: string) {
  return (
    <div className="obs-metric">
      <span className="obs-metric-label">{label}</span>
      <span className="obs-metric-value">{value}</span>
    </div>
  )
}

/**
 * Bottom telemetry strip: model/load state on the left, runtime metrics on the
 * right (decode tok/s, TTFT, prefill), plus a context-window fill gauge. The KV
 * cache lives in that context window, so a long-lived tab that keeps analyzing
 * watches the gauge climb — the memory-watch the plan calls for.
 */
export function TelemetryStrip({ status, progress, metrics, contextTokens, contextMax, worker }: Props) {
  const pct = progress.value >= 0 ? Math.round(progress.value * 100) : null
  const fill = contextMax > 0 ? Math.min(100, Math.round((contextTokens / contextMax) * 100)) : 0

  return (
    <section className="obs-telemetry">
      <div className="obs-tele-status">
        <span className={`obs-dot dot-${status}`} />
        <div className="obs-tele-text">
          <span className="obs-tele-title">
            {status === 'idle' && 'Model idle — enable LLM analysis'}
            {status === 'loading' && `Loading model… ${pct !== null ? `${pct}%` : ''}`}
            {status === 'ready' && `Model ready · ${worker ? 'Web Worker' : 'main thread'}`}
            {status === 'error' && 'Model failed to load'}
            {status === 'unsupported' && 'WebGPU unavailable — capture & reduction still run'}
          </span>
          {status === 'loading' && (
            <>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct ?? 5}%` }} />
              </div>
              <span className="obs-tele-sub">{progress.message}</span>
            </>
          )}
        </div>
      </div>

      <div className="obs-metrics">
        {stat('decode', metrics.decodeTokensPerSec ? `${metrics.decodeTokensPerSec.toFixed(1)} tok/s` : '—')}
        {stat('prefill', metrics.prefillTokensPerSec ? `${metrics.prefillTokensPerSec.toFixed(0)} tok/s` : '—')}
        {stat('TTFT', metrics.ttftMs ? `${Math.round(metrics.ttftMs)} ms` : '—')}
        <div className="obs-metric obs-gauge">
          <span className="obs-metric-label">context {contextTokens}/{contextMax}</span>
          <div className="obs-gauge-track">
            <div className={`obs-gauge-fill${fill > 85 ? ' hot' : ''}`} style={{ width: `${fill}%` }} />
          </div>
        </div>
      </div>
    </section>
  )
}
