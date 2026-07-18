import type { SignalEvent } from '../capture/types'

/**
 * Caps how many events reach the model, keeping the most recent `cap`. This is
 * the context-budget lever: fewer events in → smaller prompt → the context
 * gauge drops. Returns the kept slice plus how many were dropped, so the UI can
 * be honest about truncation rather than silently hiding events.
 */
export function sampleEvents(events: SignalEvent[], cap: number): { kept: SignalEvent[]; dropped: number } {
  if (events.length <= cap) return { kept: events, dropped: 0 }
  return { kept: events.slice(events.length - cap), dropped: events.length - cap }
}
