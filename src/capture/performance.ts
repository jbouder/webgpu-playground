import type { CaptureSource } from './types'

/**
 * Watches the platform's own performance signals via PerformanceObserver:
 * long tasks (main-thread blocks > 50ms), Largest Contentful Paint, and
 * Cumulative Layout Shift. Each observer is disconnected on teardown.
 *
 * Entry types vary by browser; we register each observer defensively so an
 * unsupported type (Safari lacks `longtask`/`layout-shift`) doesn't throw and
 * kill the others.
 */
export const capturePerformance: CaptureSource = (emit) => {
  const observers: PerformanceObserver[] = []

  const observe = (type: string, cb: (entry: PerformanceEntry) => void) => {
    try {
      const obs = new PerformanceObserver((list) => list.getEntries().forEach(cb))
      obs.observe({ type, buffered: true } as PerformanceObserverInit)
      observers.push(obs)
    } catch {
      // Entry type unsupported in this browser — skip it silently.
    }
  }

  observe('longtask', (entry) => {
    emit({
      source: 'performance',
      level: entry.duration > 200 ? 'error' : 'warn',
      message: `Long task blocked the main thread for ${Math.round(entry.duration)}ms`,
      ts: performance.now(),
      metric: 'longtask',
      value: entry.duration,
    })
  })

  observe('largest-contentful-paint', (entry) => {
    emit({
      source: 'performance',
      level: entry.startTime > 2500 ? 'warn' : 'info',
      message: `LCP at ${Math.round(entry.startTime)}ms`,
      ts: performance.now(),
      metric: 'LCP',
      value: entry.startTime,
    })
  })

  observe('layout-shift', (entry) => {
    // Only unexpected shifts (not following recent input) count toward CLS.
    const ls = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
    if (ls.hadRecentInput || ls.value < 0.05) return
    emit({
      source: 'performance',
      level: ls.value > 0.25 ? 'warn' : 'info',
      message: `Layout shift of ${ls.value.toFixed(3)}`,
      ts: performance.now(),
      metric: 'CLS',
      value: ls.value,
    })
  })

  return () => observers.forEach((o) => o.disconnect())
}
