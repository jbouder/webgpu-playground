import { useCallback, useState } from 'react'
import { DEFAULT_MODEL } from '../../../llm/models'

export type Granularity = 'event' | 'cluster' | 'session'

/**
 * The single source of truth for every toggle in the demo. Grouped to match the
 * four control-rail sections. Defaults encode the plan's non-negotiables:
 * redaction ON (leaking is opt-in), Worker ON (never block the main thread),
 * structured output ON (deterministic parsing).
 */
export interface ToggleState {
  sources: {
    console: boolean
    network: boolean
    errors: boolean
    performance: boolean
    react: boolean
  }
  reduction: {
    redact: boolean
    sample: boolean
    normalize: boolean
    dedupe: boolean
    stackframes: boolean
  }
  sampleCap: number
  llm: {
    enabled: boolean
    model: string
    structured: boolean
    streaming: boolean
    granularity: Granularity
    severity: boolean
    category: boolean
    remediation: boolean
  }
  runtime: {
    worker: boolean
  }
}

export const DEFAULT_TOGGLES: ToggleState = {
  sources: { console: true, network: true, errors: true, performance: true, react: false },
  reduction: { redact: true, sample: true, normalize: true, dedupe: true, stackframes: true },
  sampleCap: 100,
  llm: {
    enabled: false,
    model: DEFAULT_MODEL,
    structured: true,
    streaming: true,
    granularity: 'cluster',
    severity: true,
    category: true,
    remediation: true,
  },
  runtime: { worker: true },
}

export function useToggleState() {
  const [state, setState] = useState<ToggleState>(DEFAULT_TOGGLES)

  // Deep-clone then mutate a draft — keeps call sites terse without immer.
  const update = useCallback((fn: (draft: ToggleState) => void) => {
    setState((prev) => {
      const next = structuredClone(prev)
      fn(next)
      return next
    })
  }, [])

  return { state, update }
}
