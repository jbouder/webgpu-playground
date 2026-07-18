import type { CaptureSource, SignalLevel } from './types'

/**
 * Monkey-patches console.{log,info,warn,error} so every call is mirrored into
 * the event bus, then still forwarded to the original method. The teardown
 * restores the originals — critical, since a leaked patch would keep capturing
 * after the demo unmounts.
 */
const METHODS: Array<[keyof Console, SignalLevel]> = [
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
]

function stringifyArg(arg: unknown): string {
  if (typeof arg === 'string') return arg
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`
  try {
    return JSON.stringify(arg)
  } catch {
    return String(arg)
  }
}

export const captureConsole: CaptureSource = (emit) => {
  const originals = new Map<keyof Console, (...args: unknown[]) => void>()

  for (const [name, level] of METHODS) {
    const original = console[name] as (...args: unknown[]) => void
    originals.set(name, original)
    ;(console[name] as unknown) = (...args: unknown[]) => {
      emit({
        source: 'console',
        level,
        message: args.map(stringifyArg).join(' '),
        ts: performance.now(),
      })
      original.apply(console, args)
    }
  }

  return () => {
    for (const [name, original] of originals) {
      ;(console[name] as unknown) = original
    }
  }
}
