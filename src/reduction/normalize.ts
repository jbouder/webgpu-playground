/**
 * Strips the volatile bits that make otherwise-identical events look distinct:
 * UUIDs, ISO timestamps, hex addresses, long hashes, bare numbers, and dynamic
 * URL segments / cache-busting query params. This is what lets `dedupe` collapse
 * 200 near-identical lines into one cluster — without it, every request to
 * `/api/user/8821` is its own group.
 *
 * Pure and side-effect free, so it is trivially unit-testable.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
// Non-global twin for `.test()` — a global regex is stateful and misfires when
// tested repeatedly in a loop.
const UUID_TEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_TS = /\d{4}-\d{2}-\d{2}t[\d:.]+z?/gi
const HEX_ADDR = /0x[0-9a-f]+/gi
const LONG_HASH = /\b[0-9a-f]{16,}\b/gi
const NUMBER = /\b\d+(\.\d+)?\b/g

export function normalizeMessage(msg: string): string {
  return msg
    .replace(UUID, '<uuid>')
    .replace(ISO_TS, '<ts>')
    .replace(HEX_ADDR, '<addr>')
    .replace(LONG_HASH, '<hash>')
    .replace(NUMBER, '<n>')
    .trim()
}

/**
 * Collapse a URL to a stable shape: mask numeric / UUID / hash path segments to
 * `:id` and drop the query string entirely (where cache-busters live).
 */
export function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw, 'http://x')
  } catch {
    return normalizeMessage(raw)
  }
  const path = url.pathname
    .split('/')
    .map((seg) => {
      if (!seg) return seg
      if (UUID_TEST.test(seg) || /^\d+$/.test(seg) || /^[0-9a-f]{16,}$/i.test(seg)) return ':id'
      return seg
    })
    .join('/')
  const host = url.host && url.host !== 'x' ? url.host : ''
  return `${host}${path}${url.search ? '?…' : ''}`
}
