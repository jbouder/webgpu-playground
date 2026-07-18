import type { Emit, SignalEvent } from '../../../capture/types'

/**
 * The single normalized stream every capture source feeds into. Assigns each
 * event a monotonic id, keeps a bounded ring of recent events, and notifies
 * subscribers. Framework-agnostic — the React page subscribes and mirrors the
 * buffer into component state.
 */
export class EventBus {
  private events: SignalEvent[] = []
  private nextId = 1
  private subscribers = new Set<(events: SignalEvent[]) => void>()
  /** Hard cap so a `console.log` flood can't grow memory without bound. */
  private readonly max: number

  constructor(max = 2000) {
    this.max = max
  }

  /** The `emit` handed to capture sources. */
  emit: Emit = (event) => {
    const full: SignalEvent = { ...event, id: this.nextId++ }
    this.events.push(full)
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max)
    this.notify()
  }

  subscribe(cb: (events: SignalEvent[]) => void): () => void {
    this.subscribers.add(cb)
    cb(this.events)
    return () => this.subscribers.delete(cb)
  }

  getAll(): SignalEvent[] {
    return this.events
  }

  clear(): void {
    this.events = []
    this.notify()
  }

  private notify(): void {
    // Hand out a fresh array reference so React sees a new value.
    const snapshot = this.events.slice()
    this.subscribers.forEach((cb) => cb(snapshot))
  }
}
