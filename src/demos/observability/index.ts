import type { Demo } from '../../gpu/types'

// DOM-primary demo: no canvas render loop. WebGPU is exercised as the inference
// backend for WebLLM (inside a Web Worker) while the deterministic capture and
// reduction layers run on the main thread. The LLM is the narration layer, not
// the brain — every detection and classification-by-rule is deterministic;
// the model only explains, names, and summarizes, advisory-only.
export const observabilityDemo: Demo = {
  id: 'observability',
  title: 'LLM Observability',
  description:
    'Capture browser signals (console, network, errors, performance), run them through a deterministic reduction pipeline, then let an in-browser WebLLM model narrate them — clustering, severity, and advisory remediations. Every toggle is a teaching moment about why the LLM narrates rather than decides.',
}
