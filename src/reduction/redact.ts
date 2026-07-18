import type { SignalEvent } from '../capture/types'

/**
 * Masks secrets before anything downstream (the digest UI, the LLM prompt) can
 * see them: Authorization / bearer tokens, API keys, JWTs, and email addresses,
 * in both the message text and captured request headers. On by default — leaking
 * is the opt-in demo, not the reverse.
 *
 * Returns a new event; never mutates the input (the raw feed still shows the
 * original so the before/after contrast is visible).
 */
const PATTERNS: Array<[RegExp, string]> = [
  // bearer <token> (case-insensitive, keeps the scheme visible)
  [/\b(bearer)\s+[A-Za-z0-9._-]+/gi, '$1 «redacted»'],
  // JWTs: three base64url segments
  [/\bey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '«jwt»'],
  // sk-…, pk-…, ghp_…, and other long key-ish tokens
  [/\b(sk|pk|rk|ghp|gho|api|key)[-_][A-Za-z0-9]{12,}/gi, '«key»'],
  // emails
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '«email»'],
]

const SENSITIVE_HEADERS = /^(authorization|x-api-key|cookie|set-cookie|x-auth-token)$/i

function redactString(s: string): string {
  return PATTERNS.reduce((acc, [re, repl]) => acc.replace(re, repl), s)
}

export function redactEvent(event: SignalEvent): SignalEvent {
  const next: SignalEvent = { ...event, message: redactString(event.message) }

  if (event.headers) {
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(event.headers)) {
      headers[k] = SENSITIVE_HEADERS.test(k) ? '«redacted»' : redactString(v)
    }
    next.headers = headers
  }

  if (event.stack) next.stack = redactString(event.stack)
  return next
}
