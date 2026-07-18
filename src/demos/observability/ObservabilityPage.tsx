import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isWebGPUSupported } from '../../gpu/device'
import { captureConsole, captureNetwork, captureErrors, capturePerformance } from '../../capture'
import type { SignalEvent } from '../../capture/types'
import { runPipeline } from '../../reduction/pipeline'
import { ObservabilityLLM, type Metrics } from '../../llm/engine'
import { buildMessages, estimateTokens } from '../../llm/prompt'
import { parseAnalysis } from '../../llm/schema'
import { getModel } from '../../llm/models'
import { EventBus } from './state/eventBus'
import { useToggleState } from './state/useToggleState'
import { groupUnits, type AnalysisCard } from './state/analysis'
import { ControlRail } from './ControlRail'
import { InjectPanel } from './panels/InjectPanel'
import { RawFeed } from './panels/RawFeed'
import { ReducedDigest } from './panels/ReducedDigest'
import { AnalysisPanel } from './panels/AnalysisPanel'
import { TelemetryStrip, type ModelStatus } from './panels/TelemetryStrip'
import { ErrorBoundary } from './panels/ErrorBoundary'

/** Throws during render when armed — the payload the React boundary catches. */
function CrashBomb({ armed }: { armed: boolean }) {
  if (armed) throw new Error('Injected render crash: cannot read length of null')
  return null
}

export function ObservabilityPage() {
  const webgpu = useMemo(() => isWebGPUSupported(), [])
  const { state, update } = useToggleState()

  const busRef = useRef<EventBus>(null as unknown as EventBus)
  if (!busRef.current) busRef.current = new EventBus()
  const [events, setEvents] = useState<SignalEvent[]>([])

  // ---- Engine + analysis state ----
  const engineRef = useRef<ObservabilityLLM | null>(null)
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle')
  const [progress, setProgress] = useState<{ message: string; value: number }>({ message: 'Waiting…', value: -1 })
  const [metrics, setMetrics] = useState<Metrics>({})
  const [contextTokens, setContextTokens] = useState(0)
  const [cards, setCards] = useState<AnalysisCard[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const stopRef = useRef(false)

  // ---- React error-boundary source ----
  const [armed, setArmed] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const handleCrashCaught = useCallback((error: Error, componentStack: string) => {
    busRef.current.emit({
      source: 'react',
      level: 'error',
      message: error.message,
      ts: performance.now(),
      stack: error.stack || componentStack,
    })
    setArmed(false)
    setResetKey((k) => k + 1)
  }, [])

  // Mirror the bus into React state.
  useEffect(() => busRef.current.subscribe(setEvents), [])

  // Install/uninstall each capture source when its toggle flips. Each returns a
  // teardown that restores whatever it patched — critical for correctness.
  const emit = busRef.current.emit
  useEffect(() => (state.sources.console ? captureConsole(emit) : undefined), [state.sources.console, emit])
  useEffect(() => (state.sources.network ? captureNetwork(emit) : undefined), [state.sources.network, emit])
  useEffect(() => (state.sources.errors ? captureErrors(emit) : undefined), [state.sources.errors, emit])
  useEffect(() => (state.sources.performance ? capturePerformance(emit) : undefined), [state.sources.performance, emit])

  // Run the reduction pipeline whenever events or the pipeline config change.
  const digest = useMemo(
    () =>
      runPipeline(events, {
        redact: state.reduction.redact,
        sample: state.reduction.sample,
        sampleCap: state.sampleCap,
        normalize: state.reduction.normalize,
        dedupe: state.reduction.dedupe,
        stackframes: state.reduction.stackframes,
      }),
    [events, state.reduction, state.sampleCap],
  )

  // Load / reload the model when analysis is enabled or model/worker mode change.
  useEffect(() => {
    if (!webgpu || !state.llm.enabled) {
      setModelStatus(webgpu ? 'idle' : 'unsupported')
      return
    }
    let cancelled = false
    const engine = engineRef.current ?? new ObservabilityLLM()
    engineRef.current = engine
    engine.onProgress = (p) => setProgress({ message: p.message, value: p.progress })
    setModelStatus('loading')
    engine
      .load(state.llm.model, state.runtime.worker)
      .then(() => !cancelled && setModelStatus('ready'))
      .catch((err) => {
        if (cancelled) return
        setProgress({ message: err instanceof Error ? err.message : String(err), value: -1 })
        setModelStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [webgpu, state.llm.enabled, state.llm.model, state.runtime.worker])

  // Dispose the engine when the demo unmounts.
  useEffect(() => () => void engineRef.current?.dispose(), [])

  const patchCard = (i: number, patch: Partial<AnalysisCard>) =>
    setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const runAnalysis = async () => {
    const engine = engineRef.current
    if (!engine?.ready) return
    const units = groupUnits(digest.clusters, state.llm.granularity)
    if (units.length === 0) return

    stopRef.current = false
    setAnalyzing(true)
    setCards(units.map((u, i) => ({ id: String(i), label: u.label, text: '', done: false })))
    const wants = { severity: state.llm.severity, category: state.llm.category, remediation: state.llm.remediation }

    try {
      for (let i = 0; i < units.length; i++) {
        if (stopRef.current) break
        const messages = buildMessages(units[i].clusters, state.llm.structured, wants)
        setContextTokens(estimateTokens(messages))
        let acc = ''
        try {
          const { text, metrics: m } = await engine.analyze(messages, {
            structured: state.llm.structured,
            stream: state.llm.streaming,
            onToken: (d) => {
              acc += d
              patchCard(i, { text: acc })
            },
          })
          setMetrics(m)
          if (m.promptTokens || m.completionTokens)
            setContextTokens((m.promptTokens ?? 0) + (m.completionTokens ?? 0))
          const parsed = state.llm.structured ? parseAnalysis(text) : undefined
          patchCard(i, { text, parsed, done: true })
        } catch (err) {
          patchCard(i, { done: true, error: err instanceof Error ? err.message : String(err) })
        }
      }
    } finally {
      setAnalyzing(false)
    }
  }

  const stopAnalysis = () => {
    stopRef.current = true
    engineRef.current?.interrupt()
  }

  const clearAll = () => {
    busRef.current.clear()
    setCards([])
  }

  const canAnalyze = modelStatus === 'ready' && digest.clusters.length > 0
  const disabledReason = !webgpu
    ? 'WebGPU is unavailable, so LLM analysis is disabled. Capture and reduction still run.'
    : !state.llm.enabled
      ? 'Enable “LLM analysis” in the control rail, then load a model.'
      : modelStatus !== 'ready'
        ? 'Model is still loading…'
        : 'Capture some signals first — the digest is empty.'

  const contextMax = getModel(state.llm.model).contextTokens

  return (
    <div className="obs-page">
      <ControlRail state={state} update={update} webgpu={webgpu} />

      <div className="obs-stage">
        <div className="obs-toolbar">
          <span className="obs-toolbar-title">Observability</span>
          <span className="obs-toolbar-sub">{events.length} signals · {digest.clusters.length} clusters</span>
          <button type="button" className="ghost obs-clear" onClick={clearAll}>
            Clear
          </button>
        </div>

        <InjectPanel sources={state.sources} onCrashComponent={() => setArmed(true)} />

        {state.sources.react && (
          <ErrorBoundary key={resetKey} onCaught={handleCrashCaught}>
            <CrashBomb armed={armed} />
          </ErrorBoundary>
        )}

        <div className="obs-split">
          <RawFeed events={events} />
          <ReducedDigest digest={digest} />
        </div>

        <AnalysisPanel
          cards={cards}
          analyzing={analyzing}
          structured={state.llm.structured}
          canAnalyze={canAnalyze}
          disabledReason={disabledReason}
          onAnalyze={runAnalysis}
          onStop={stopAnalysis}
        />

        <TelemetryStrip
          status={modelStatus}
          progress={progress}
          metrics={metrics}
          contextTokens={contextTokens}
          contextMax={contextMax}
          worker={state.runtime.worker}
        />
      </div>
    </div>
  )
}
