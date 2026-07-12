/**
 * Minimal CPU-side linear scale + tick helpers for axes and pointer↔data
 * mapping. Deliberately tiny (no d3 dependency) and never in the GPU data path
 * — only used for labels, ticks, and hit-testing a few pointer coordinates.
 *
 * Pure and framework-agnostic.
 */

export interface LinearScale {
  (value: number): number
  invert(px: number): number
  domain: [number, number]
  range: [number, number]
}

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const dspan = d1 - d0 || 1
  const rspan = r1 - r0
  const fn = ((value: number) => r0 + ((value - d0) / dspan) * rspan) as LinearScale
  fn.invert = (px: number) => d0 + ((px - r0) / (rspan || 1)) * dspan
  fn.domain = domain
  fn.range = range
  return fn
}

/**
 * "Nice" round tick values spanning [min, max], à la d3.ticks. Returns roughly
 * `count` ticks landing on 1/2/5·10ⁿ boundaries.
 */
export function ticks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min]
  const span = max - min
  const step0 = Math.pow(10, Math.floor(Math.log10(span / count)))
  const err = (span / count) / step0
  const step = err >= 7.5 ? step0 * 10 : err >= 3.5 ? step0 * 5 : err >= 1.5 ? step0 * 2 : step0

  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 1e-6; v += step) {
    // Snap away tiny float drift so labels read cleanly.
    out.push(Math.round(v / step) * step)
  }
  return out
}
