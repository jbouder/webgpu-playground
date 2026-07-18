import type { SignalEvent } from '../capture/types'
import type { Digest, ReductionConfig } from './types'
import { redactEvent } from './redact'
import { sampleEvents } from './sample'
import { clusterEvents, passthroughClusters } from './dedupe'
import { parseStack } from './stackframes'

/**
 * Composes the enabled reduction stages, in order, into a Digest. Every stage
 * is optional and independently toggleable so the before/after collapse is
 * visible in the UI:
 *
 *   redact → sample → cluster(normalize?) → stack-frame extraction
 *
 * Redaction runs first so no secret survives into any later representation.
 * With every stage off, the digest is just one cluster per raw event, which is
 * the point — the toggles *are* the teaching moment.
 */
export function runPipeline(events: SignalEvent[], config: ReductionConfig): Digest {
  const total = events.length

  // 1. Redact — mask secrets before anything else touches the data.
  let working = config.redact ? events.map(redactEvent) : events

  // 2. Sample — cap how many events the rest of the pipeline (and the model) see.
  let dropped = 0
  if (config.sample) {
    const { kept, dropped: d } = sampleEvents(working, config.sampleCap)
    working = kept
    dropped = d
  }

  // 3. Cluster — collapse repeats. Off ⇒ one cluster per event.
  let clusters = config.dedupe
    ? clusterEvents(working, config.normalize)
    : passthroughClusters(working)

  // 4. Stack frames — parse the representative event's stack per cluster.
  if (config.stackframes) {
    clusters = clusters.map((c) =>
      c.sample.stack ? { ...c, frames: parseStack(c.sample.stack) } : c,
    )
  }

  return {
    clusters,
    totalEvents: total,
    keptEvents: working.length,
    droppedBySample: dropped,
  }
}
