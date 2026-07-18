import type { ToggleState } from '../state/useToggleState'

interface Props {
  sources: ToggleState['sources']
  /** Renders a component that throws, exercising the error boundary source. */
  onCrashComponent: () => void
}

// A throwaway id so flooded lines differ only in volatile bits — the normalize
// stage collapses them, the raw feed shows them all.
const rid = () => Math.random().toString(16).slice(2, 10)

/**
 * The "make it not inert" panel: buttons that *cause* real browser signals so
 * every downstream stage has something to chew on. Each button routes through
 * the genuine browser API the matching capture source patches, so a source
 * that's toggled off simply won't record it — the buttons are disabled in that
 * case to make the dependency obvious.
 */
export function InjectPanel({ sources, onCrashComponent }: Props) {
  const throwError = () => {
    // Async so it escapes React's handler and hits window.onerror for real.
    setTimeout(() => {
      throw new Error(`Cannot read properties of undefined (reading 'profile') [${rid()}]`)
    }, 0)
  }

  const rejectPromise = () => {
    // Intentionally unhandled → 'unhandledrejection'.
    void Promise.reject(new Error('Request aborted: the user navigated away'))
  }

  const floodConsole = () => {
    for (let i = 0; i < 30; i++) {
      console.error(`Render failed for item ${i} (key=${rid()}) at 2026-01-0${(i % 9) + 1}T10:00:00Z`)
    }
    console.warn('Deprecation: `componentWillMount` is deprecated and will be removed.')
  }

  const longTask = () => {
    // Block the main thread long enough to trip the longtask observer.
    const end = performance.now() + 220
    let x = 0
    while (performance.now() < end) x += Math.sqrt(x + 1)
    console.info(`Finished heavy sync work (${x.toFixed(0)})`)
  }

  const apiRequestWithToken = () => {
    // A real, offline-safe request (data: URL → 200) carrying a bearer token and
    // an email — the payload the redaction stage exists to mask. The wrapper
    // records the outgoing headers regardless of the response.
    const body = encodeURIComponent(JSON.stringify({ user: 'alex@example.com', ok: true }))
    void fetch(`data:application/json,${body}`, {
      headers: {
        Authorization: `Bearer sk-live-${rid()}${rid()}${rid()}`,
        'X-Api-Key': `key_${rid()}${rid()}`,
      },
    }).catch(() => {})
  }

  const failedRequest = () => {
    // Connection-refused host → a real network-error event, fast and offline-safe.
    void fetch(`https://localhost:1/api/orders/${rid()}`).catch(() => {})
  }

  const buttons: Array<{ label: string; onClick: () => void; needs: keyof ToggleState['sources'] }> = [
    { label: 'Throw error', onClick: throwError, needs: 'errors' },
    { label: 'Reject promise', onClick: rejectPromise, needs: 'errors' },
    { label: 'Crash component', onClick: onCrashComponent, needs: 'react' },
    { label: 'Flood console', onClick: floodConsole, needs: 'console' },
    { label: 'Trigger long task', onClick: longTask, needs: 'performance' },
    { label: 'API request', onClick: apiRequestWithToken, needs: 'network' },
    { label: 'Leak a token', onClick: apiRequestWithToken, needs: 'network' },
    { label: 'Failed request', onClick: failedRequest, needs: 'network' },
  ]

  return (
    <section className="obs-inject">
      <div className="obs-panel-head">
        <h3>Inject events</h3>
        <span className="obs-panel-sub">cause real signals — nothing here is mocked away</span>
      </div>
      <div className="obs-inject-grid">
        {buttons.map((b, i) => {
          const off = !sources[b.needs]
          return (
            <button
              key={i}
              type="button"
              className="obs-inject-btn"
              onClick={b.onClick}
              disabled={off}
              title={off ? `Enable the "${b.needs}" source to capture this` : `Captured by the ${b.needs} source`}
            >
              {b.label}
            </button>
          )
        })}
      </div>
    </section>
  )
}
