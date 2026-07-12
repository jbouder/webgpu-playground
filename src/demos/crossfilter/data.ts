/**
 * Synthetic telemetry dataset for the crossfilter dashboard, framed as
 * LLM-monitoring data (latency, cost, tokens, time-of-day). Generated and
 * pre-binned on the CPU once, then handed to the GPU as a single columnar
 * buffer — the CPU never touches per-row data again after upload.
 *
 * Each row's four bin indices (0..BINS-1, one per dimension) are packed into a
 * single u32 so the GPU reads one word per row:
 *   latency | cost<<6 | tokens<<12 | time<<18   (6 bits / dimension)
 *
 * Pure and framework-agnostic.
 */

export const BINS = 64 // bins per 1D axis (and per scatter axis)

export interface Dimension {
  key: string
  label: string
  unit: string
  min: number
  max: number
  /** Format a bin's center value for readouts. */
  format: (value: number) => string
}

// Dimension order matters: it defines the bit-packing and the panel layout.
export const DIMENSIONS: Dimension[] = [
  { key: 'latency', label: 'Latency', unit: 'ms', min: 0, max: 2000, format: (v) => `${Math.round(v)} ms` },
  { key: 'cost', label: 'Cost', unit: '$', min: 0, max: 0.05, format: (v) => `$${v.toFixed(4)}` },
  { key: 'tokens', label: 'Tokens', unit: '', min: 0, max: 4000, format: (v) => `${Math.round(v)}` },
  { key: 'time', label: 'Time of day', unit: 'h', min: 0, max: 24, format: (v) => `${v.toFixed(1)} h` },
]

function binOf(value: number, min: number, max: number): number {
  const t = (value - min) / (max - min)
  return Math.max(0, Math.min(BINS - 1, Math.floor(t * BINS)))
}

/** The center value of a bin, in a dimension's native units. */
export function binCenter(dim: Dimension, bin: number): number {
  return dim.min + ((bin + 0.5) / BINS) * (dim.max - dim.min)
}

// Standard normal via Box–Muller.
function randn(): number {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/**
 * Build `n` packed rows. Dimensions are correlated the way real telemetry is:
 * request size (tokens) drives cost and latency, load has a diurnal shape, and
 * the distributions are spread wide (log-normal request sizes with a long tail)
 * so brushing one panel visibly reshapes the others rather than nudging them.
 */
export function generatePackedRows(n: number): Uint32Array {
  const rows = new Uint32Array(n)
  for (let i = 0; i < n; i++) {
    // Time of day, spread across the day with an afternoon-weighted bulge.
    const hour = (13 + randn() * 6 + 24) % 24
    const load = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(((hour - 8) / 24) * Math.PI * 2))

    // Log-normal request size: heavy right tail, heavier under load.
    const tokens = Math.exp(6.4 + randn() * 0.9 + load * 0.5)
    // Cost tracks tokens with per-request variance.
    const cost = tokens * 0.0000105 * (1 + randn() * 0.18) + 0.0006 + Math.abs(randn()) * 0.0009
    // Latency tracks tokens + load, with a fat noise term.
    const latency = 140 + tokens * 0.42 + load * 420 + randn() * 240

    rows[i] =
      binOf(latency, 0, 2000) |
      (binOf(cost, 0, 0.05) << 6) |
      (binOf(tokens, 0, 4000) << 12) |
      (binOf(hour, 0, 24) << 18)
  }
  return rows
}

export const ROW_COUNT_OPTIONS = [
  { label: '250K', value: 250_000 },
  { label: '1M', value: 1_000_000 },
  { label: '4M', value: 4_000_000 },
  { label: '10M', value: 10_000_000 },
]
