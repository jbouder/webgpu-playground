import type { StackFrame } from './types'

/**
 * Parses a raw stack-trace string into structured frames. Handles the two
 * common shapes:
 *   V8/Chrome:  "    at fnName (https://host/file.js:12:34)"
 *   Firefox:    "fnName@https://host/file.js:12:34"
 * Unparseable lines are skipped. Pure — feed it `error.stack`, get frames back.
 */
const V8 = /^\s*at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)\s*$/
const V8_ANON = /^\s*at\s+(.+?):(\d+):(\d+)\s*$/
const FIREFOX = /^(.*?)@(.+?):(\d+):(\d+)\s*$/

export function parseStack(stack: string | undefined, limit = 8): StackFrame[] {
  if (!stack) return []
  const frames: StackFrame[] = []
  for (const line of stack.split('\n')) {
    if (frames.length >= limit) break
    let m = line.match(V8)
    if (m) {
      frames.push({ fn: m[1], file: m[2], line: Number(m[3]), col: Number(m[4]) })
      continue
    }
    m = line.match(V8_ANON)
    if (m) {
      frames.push({ fn: '<anonymous>', file: m[1], line: Number(m[2]), col: Number(m[3]) })
      continue
    }
    m = line.match(FIREFOX)
    if (m) {
      frames.push({ fn: m[1] || '<anonymous>', file: m[2], line: Number(m[3]), col: Number(m[4]) })
    }
  }
  return frames
}
