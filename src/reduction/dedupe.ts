import type { SignalEvent, SignalLevel } from '../capture/types'
import type { Cluster } from './types'
import { normalizeMessage, normalizeUrl } from './normalize'

const LEVEL_RANK: Record<SignalLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

/** The key an event is grouped by. Network keys keep status so 500s and 200s
 *  don't merge; everything else keys on its (optionally normalized) message. */
function signatureOf(event: SignalEvent, normalize: boolean): string {
  if (event.source === 'network' && event.url) {
    const url = normalize ? normalizeUrl(event.url) : event.url
    return `${event.method ?? 'GET'} ${url} → ${event.status ?? 'err'}`
  }
  const msg = normalize ? normalizeMessage(event.message) : event.message
  return `${event.source}:${msg}`
}

/**
 * Collapses events sharing a signature into one cluster carrying a count and
 * the highest severity seen. When `normalize` is off, signatures are exact, so
 * only byte-identical events merge — which is exactly how the before/after
 * toggle shows the reduction working. Preserves first-seen order.
 */
export function clusterEvents(events: SignalEvent[], normalize: boolean): Cluster[] {
  const byKey = new Map<string, Cluster>()
  for (const event of events) {
    const signature = signatureOf(event, normalize)
    const existing = byKey.get(signature)
    if (existing) {
      existing.count++
      if (LEVEL_RANK[event.level] > LEVEL_RANK[existing.level]) existing.level = event.level
    } else {
      byKey.set(signature, {
        id: signature,
        signature,
        source: event.source,
        level: event.level,
        count: 1,
        sample: event,
      })
    }
  }
  return [...byKey.values()]
}

/** No-clustering path: one cluster per event (so the digest === raw feed). */
export function passthroughClusters(events: SignalEvent[]): Cluster[] {
  return events.map((event) => ({
    id: String(event.id),
    signature: event.message,
    source: event.source,
    level: event.level,
    count: 1,
    sample: event,
  }))
}
