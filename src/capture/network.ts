import type { CaptureSource, SignalLevel } from './types'

/**
 * Wraps both `fetch` and `XMLHttpRequest` to record method, URL, status, and
 * timing. Request headers are captured verbatim (including any auth token) so
 * the redaction stage has something real to mask. A status >= 400 or a thrown
 * request is emitted at `error` level. Teardown restores both originals.
 *
 * We time with performance.now() rather than reading PerformanceObserver
 * resource entries: it keeps the request→event mapping exact and avoids a
 * second async hop. (The performance source covers PerformanceObserver.)
 */
function levelForStatus(status: number, failed: boolean): SignalLevel {
  if (failed || status >= 500) return 'error'
  if (status >= 400) return 'warn'
  return 'info'
}

function headersToObject(init?: HeadersInit): Record<string, string> {
  const out: Record<string, string> = {}
  if (!init) return out
  if (init instanceof Headers) {
    init.forEach((v, k) => (out[k] = v))
  } else if (Array.isArray(init)) {
    for (const [k, v] of init) out[k] = v
  } else {
    Object.assign(out, init)
  }
  return out
}

export const captureNetwork: CaptureSource = (emit) => {
  const originalFetch = window.fetch
  const originalOpen = XMLHttpRequest.prototype.open
  const originalSend = XMLHttpRequest.prototype.send
  const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader

  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const start = performance.now()
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const url = input instanceof Request ? input.url : String(input)
    const headers = headersToObject(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    try {
      const res = await originalFetch(input, init)
      const durationMs = performance.now() - start
      const sizeHeader = res.headers.get('content-length')
      emit({
        source: 'network',
        level: levelForStatus(res.status, false),
        message: `${method} ${url} → ${res.status} ${res.statusText}`,
        ts: performance.now(),
        method,
        url,
        status: res.status,
        durationMs,
        sizeBytes: sizeHeader ? Number(sizeHeader) : undefined,
        headers,
      })
      return res
    } catch (err) {
      emit({
        source: 'network',
        level: 'error',
        message: `${method} ${url} → network error: ${err instanceof Error ? err.message : String(err)}`,
        ts: performance.now(),
        method,
        url,
        durationMs: performance.now() - start,
        headers,
      })
      throw err
    }
  }

  // XHR: stash per-request metadata on the instance across open→send→load.
  interface Tracked extends XMLHttpRequest {
    __obs?: { method: string; url: string; start: number; headers: Record<string, string> }
  }

  XMLHttpRequest.prototype.open = function (this: Tracked, method: string, url: string | URL) {
    this.__obs = { method: method.toUpperCase(), url: String(url), start: 0, headers: {} }
    // eslint-disable-next-line prefer-rest-params
    return originalOpen.apply(this, arguments as never)
  } as typeof XMLHttpRequest.prototype.open

  XMLHttpRequest.prototype.setRequestHeader = function (this: Tracked, name: string, value: string) {
    if (this.__obs) this.__obs.headers[name] = value
    return originalSetHeader.call(this, name, value)
  }

  XMLHttpRequest.prototype.send = function (this: Tracked, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = this.__obs
    if (meta) {
      meta.start = performance.now()
      const done = () => {
        const durationMs = performance.now() - meta.start
        const failed = this.status === 0
        emit({
          source: 'network',
          level: levelForStatus(this.status, failed),
          message: `${meta.method} ${meta.url} → ${failed ? 'failed' : this.status}`,
          ts: performance.now(),
          method: meta.method,
          url: meta.url,
          status: this.status || undefined,
          durationMs,
          sizeBytes: this.responseText ? this.responseText.length : undefined,
          headers: meta.headers,
        })
      }
      this.addEventListener('loadend', done, { once: true })
    }
    return originalSend.call(this, body ?? null)
  }

  return () => {
    window.fetch = originalFetch
    XMLHttpRequest.prototype.open = originalOpen
    XMLHttpRequest.prototype.send = originalSend
    XMLHttpRequest.prototype.setRequestHeader = originalSetHeader
  }
}
