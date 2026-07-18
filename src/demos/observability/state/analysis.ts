import type { Cluster } from '../../../reduction/types'
import type { AnalysisResult } from '../../../llm/schema'
import type { Granularity } from './useToggleState'

/** One streamed analysis result, rendered as a card. */
export interface AnalysisCard {
  id: string
  label: string
  /** Raw model text as it streams. */
  text: string
  /** Parsed structured result (structured mode only), set when parseable. */
  parsed?: AnalysisResult | null
  done: boolean
  error?: string
}

/**
 * Splits the digest's clusters into analysis units per the granularity toggle:
 *   session  → one unit (the whole digest)
 *   cluster  → one unit per source (related signals grouped)
 *   event    → one unit per cluster (finest; most model calls)
 */
export function groupUnits(clusters: Cluster[], granularity: Granularity): Array<{ label: string; clusters: Cluster[] }> {
  if (clusters.length === 0) return []
  if (granularity === 'session') {
    return [{ label: 'Session digest', clusters }]
  }
  if (granularity === 'event') {
    return clusters.map((c) => ({ label: `${c.source}: ${c.sample.message.slice(0, 40)}`, clusters: [c] }))
  }
  // cluster → group by source
  const bySource = new Map<string, Cluster[]>()
  for (const c of clusters) {
    const arr = bySource.get(c.source) ?? []
    arr.push(c)
    bySource.set(c.source, arr)
  }
  return [...bySource.entries()].map(([source, cs]) => ({ label: `${source} (${cs.length})`, clusters: cs }))
}
