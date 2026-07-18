import type { CaptureSource } from './types'

/**
 * Captures uncaught exceptions (`window.onerror` via the 'error' event) and
 * unhandled promise rejections. Both carry a stack when one is available, which
 * the stack-frame reduction stage later parses into structured frames. Uses
 * addEventListener/removeEventListener so teardown is clean and we don't clobber
 * any existing window.onerror handler.
 */
export const captureErrors: CaptureSource = (emit) => {
  const onError = (e: ErrorEvent) => {
    emit({
      source: 'error',
      level: 'error',
      message: e.message || 'Uncaught error',
      ts: performance.now(),
      stack: e.error instanceof Error ? e.error.stack : undefined,
    })
  }

  const onRejection = (e: PromiseRejectionEvent) => {
    const reason = e.reason
    emit({
      source: 'error',
      level: 'error',
      message: `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`,
      ts: performance.now(),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
