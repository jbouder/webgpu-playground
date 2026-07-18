import type { ReactNode } from 'react'
import type { ToggleState, Granularity } from './state/useToggleState'
import { MODELS } from '../../llm/models'

interface Props {
  state: ToggleState
  update: (fn: (draft: ToggleState) => void) => void
  /** When WebGPU is absent the LLM section is disabled but capture still runs. */
  webgpu: boolean
}

function Switch({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  hint?: string
}) {
  return (
    <label className={`obs-switch${disabled ? ' is-disabled' : ''}`} title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="obs-switch-track">
        <span className="obs-switch-thumb" />
      </span>
      <span className="obs-switch-label">{label}</span>
    </label>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <details className="obs-section" open>
      <summary>
        <span className="obs-section-title">{title}</span>
      </summary>
      {note && <p className="obs-section-note">{note}</p>}
      <div className="obs-section-body">{children}</div>
    </details>
  )
}

/**
 * The left control rail: four grouped sections mirroring the architecture.
 * Every toggle doubles as a teaching moment — the notes make the "LLM is the
 * narration layer, not the brain" story visible while you flip switches.
 */
export function ControlRail({ state, update, webgpu }: Props) {
  const { sources, reduction, llm, runtime } = state
  const llmOff = !webgpu

  return (
    <aside className="obs-rail">
      <Section title="1 · Signal sources" note="What gets captured. Each streams into one normalized bus.">
        <Switch label="Console" checked={sources.console} onChange={(v) => update((d) => (d.sources.console = v))} />
        <Switch label="Network (fetch + XHR)" checked={sources.network} onChange={(v) => update((d) => (d.sources.network = v))} />
        <Switch label="Unhandled errors" checked={sources.errors} onChange={(v) => update((d) => (d.sources.errors = v))} />
        <Switch label="Performance (longtask/LCP/CLS)" checked={sources.performance} onChange={(v) => update((d) => (d.sources.performance = v))} />
        <Switch label="React error boundary" checked={sources.react} onChange={(v) => update((d) => (d.sources.react = v))} />
      </Section>

      <Section title="2 · Reduction pipeline" note="Never feed raw streams to the model. Each stage is visible in the digest.">
        <Switch label="Redact secrets" checked={reduction.redact} onChange={(v) => update((d) => (d.reduction.redact = v))} hint="On by default — leaking is the opt-in demo" />
        <Switch label="Sampling cap" checked={reduction.sample} onChange={(v) => update((d) => (d.reduction.sample = v))} />
        <div className="obs-slider">
          <span>max events: {state.sampleCap}</span>
          <input
            type="range"
            min={5}
            max={500}
            step={5}
            value={state.sampleCap}
            disabled={!reduction.sample}
            onChange={(e) => update((d) => (d.sampleCap = Number(e.target.value)))}
          />
        </div>
        <Switch label="Normalize (strip ids/timestamps)" checked={reduction.normalize} onChange={(v) => update((d) => (d.reduction.normalize = v))} />
        <Switch label="Dedupe & cluster" checked={reduction.dedupe} onChange={(v) => update((d) => (d.reduction.dedupe = v))} />
        <Switch label="Stack-frame extraction" checked={reduction.stackframes} onChange={(v) => update((d) => (d.reduction.stackframes = v))} />
      </Section>

      <Section title="3 · LLM analysis" note={llmOff ? 'WebGPU unavailable — analysis disabled, capture still runs.' : 'The narration layer. Advisory only; nothing here triggers an action.'}>
        <Switch label="Enable analysis" checked={llm.enabled} disabled={llmOff} onChange={(v) => update((d) => (d.llm.enabled = v))} />
        <div className="obs-field">
          <span>Model</span>
          <select className="model-select" value={llm.model} disabled={llmOff} onChange={(e) => update((d) => (d.llm.model = e.target.value))}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} · {m.size}
              </option>
            ))}
          </select>
        </div>
        <Switch label="Structured output (JSON schema)" checked={llm.structured} disabled={llmOff} onChange={(v) => update((d) => (d.llm.structured = v))} hint="XGrammar-constrained; off = freeform prose" />
        <Switch label="Streaming tokens" checked={llm.streaming} disabled={llmOff} onChange={(v) => update((d) => (d.llm.streaming = v))} />
        <div className="obs-field">
          <span>Granularity</span>
          <select className="model-select" value={llm.granularity} disabled={llmOff} onChange={(e) => update((d) => (d.llm.granularity = e.target.value as Granularity))}>
            <option value="event">per-event</option>
            <option value="cluster">cluster-summary</option>
            <option value="session">session-digest</option>
          </select>
        </div>
        <div className="obs-subgroup">
          <Switch label="Severity" checked={llm.severity} disabled={llmOff} onChange={(v) => update((d) => (d.llm.severity = v))} />
          <Switch label="Category" checked={llm.category} disabled={llmOff} onChange={(v) => update((d) => (d.llm.category = v))} />
          <Switch label="Remediation" checked={llm.remediation} disabled={llmOff} onChange={(v) => update((d) => (d.llm.remediation = v))} />
        </div>
      </Section>

      <Section title="4 · Runtime" note="Showcase the engineering. Worker-off is a demo, not the default.">
        <Switch label="Web Worker inference" checked={runtime.worker} disabled={llmOff} onChange={(v) => update((d) => (d.runtime.worker = v))} hint="Off = inference on the main thread (watch the jank)" />
        <div className="obs-field-static">
          <span>Backend</span>
          <span className={webgpu ? 'obs-ok' : 'obs-warn'}>{webgpu ? 'WebGPU' : 'unavailable (WASM fallback N/A for LLM)'}</span>
        </div>
      </Section>
    </aside>
  )
}
