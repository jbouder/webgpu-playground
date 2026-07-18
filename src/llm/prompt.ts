import type { Cluster } from '../reduction/types'
import { ANALYSIS_SCHEMA_STRING } from './schema'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Which advisory dimensions the analysis should include (each a sub-toggle). */
export interface AnalysisWants {
  severity: boolean
  category: boolean
  remediation: boolean
}

/** Render a set of clusters into compact, model-friendly text. */
export function renderClusters(clusters: Cluster[]): string {
  return clusters
    .map((c, i) => {
      const s = c.sample
      const parts = [`#${i + 1} [${c.source}/${c.level}] ×${c.count}: ${s.message}`]
      if (s.status) parts.push(`  status=${s.status}`)
      if (s.durationMs != null) parts.push(`  duration=${Math.round(s.durationMs)}ms`)
      if (c.frames && c.frames.length) {
        parts.push(`  at ${c.frames[0].fn} (${c.frames[0].file}:${c.frames[0].line ?? '?'})`)
      }
      return parts.join('\n')
    })
    .join('\n')
}

const BASE_SYSTEM = `You are a debugging assistant embedded in a browser DevTools-style panel.
You are given a REDUCED digest of captured browser signals (console, network, errors, performance).
Your job is to NARRATE for a developer: name the pattern, summarize what happened, and — advisory only —
suggest what a human might check. You never trigger actions; nothing you say is executed.
Be concise and concrete. Do not invent signals that are not in the digest.`

/** Build the messages for one analysis unit (a list of related clusters). */
export function buildMessages(clusters: Cluster[], structured: boolean, wants: AnalysisWants): ChatMessage[] {
  const digestText = renderClusters(clusters)
  const dims: string[] = []
  if (wants.severity) dims.push('a severity')
  if (wants.category) dims.push('a category')
  if (wants.remediation) dims.push('a suggested action (advisory)')

  let instruction: string
  if (structured) {
    instruction =
      `Analyze the digest below and respond with a SINGLE JSON object matching this schema ` +
      `(and nothing else):\n${ANALYSIS_SCHEMA_STRING}\n\n` +
      `Set affectedCount to the total number of events across the clusters. ` +
      `suggestedAction is advisory only.`
  } else {
    const wanted = dims.length ? dims.join(', ') : 'a short summary'
    instruction = `Analyze the digest below. In 2-4 short sentences of prose, give ${wanted}. Advisory only.`
  }

  return [
    { role: 'system', content: BASE_SYSTEM },
    { role: 'user', content: `${instruction}\n\n--- DIGEST ---\n${digestText}` },
  ]
}

/** Rough token estimate (~4 chars/token) for the context-fill gauge. */
export function estimateTokens(messages: ChatMessage[]): number {
  const chars = messages.reduce((n, m) => n + m.content.length, 0)
  return Math.ceil(chars / 4)
}
