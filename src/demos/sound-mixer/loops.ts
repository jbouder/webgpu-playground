/**
 * Procedural loop synthesis. Renders a handful of short, phase-locked 1-bar
 * loops (drums, bass, chords) straight into AudioBuffers so the mixer is
 * playable the moment it opens — no uploads, no permission prompts, a clean
 * signal. All loops share a tempo and length so they stay in sync when looped.
 *
 * Pure DSP into channel data — deterministic and framework-agnostic.
 */

const BPM = 120
const BEATS_PER_BAR = 4
export const BAR_SECONDS = (60 / BPM) * BEATS_PER_BAR // one bar = 2s at 120bpm
const BEAT = 60 / BPM // 0.5s

export interface LoopDef {
  name: string
  gain: number
  render: (data: Float32Array, sr: number) => void
}

// --- one-shot voices, summed into the buffer at a sample offset ---

function addKick(data: Float32Array, sr: number, at: number) {
  const dur = 0.35
  const start = Math.floor(at * sr)
  for (let i = 0; i < dur * sr; i++) {
    const t = i / sr
    // Pitch drops from ~140Hz to ~50Hz; amplitude decays fast.
    const freq = 50 + 90 * Math.exp(-t * 35)
    const env = Math.exp(-t * 7)
    const idx = start + i
    if (idx < data.length) data[idx] += Math.sin(2 * Math.PI * freq * t) * env * 0.9
  }
}

function addHat(data: Float32Array, sr: number, at: number, amp: number) {
  const dur = 0.05
  const start = Math.floor(at * sr)
  for (let i = 0; i < dur * sr; i++) {
    const t = i / sr
    const env = Math.exp(-t * 90)
    const idx = start + i
    if (idx < data.length) data[idx] += (Math.random() * 2 - 1) * env * amp
  }
}

type Wave = 'saw' | 'square' | 'sine'

function osc(type: Wave, phase: number): number {
  const p = phase - Math.floor(phase)
  if (type === 'saw') return 2 * p - 1
  if (type === 'square') return p < 0.5 ? 1 : -1
  return Math.sin(2 * Math.PI * p)
}

function addNote(
  data: Float32Array,
  sr: number,
  at: number,
  freq: number,
  dur: number,
  amp: number,
  type: Wave,
) {
  const start = Math.floor(at * sr)
  const n = Math.floor(dur * sr)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    // Short attack, exponential release — keeps notes from clicking.
    const attack = Math.min(1, t / 0.01)
    const release = Math.exp(-t * (2.5 / dur))
    const idx = start + i
    if (idx < data.length) data[idx] += osc(type, freq * t) * amp * attack * release
  }
}

// A-minor material so the loops harmonize.
const A1 = 55.0
const A2 = 110.0
const C3 = 130.81
const E2 = 82.41
const A3 = 220.0
const C4 = 261.63
const E4 = 329.63

export const LOOPS: LoopDef[] = [
  {
    name: 'Kick',
    gain: 0.9,
    render: (data, sr) => {
      // Four-on-the-floor.
      for (let b = 0; b < BEATS_PER_BAR; b++) addKick(data, sr, b * BEAT)
    },
  },
  {
    name: 'Hats',
    gain: 0.5,
    render: (data, sr) => {
      // Offbeat 8th-note hats, accented on the beat's upswing.
      for (let b = 0; b < BEATS_PER_BAR; b++) {
        addHat(data, sr, b * BEAT + BEAT / 2, 0.3)
        addHat(data, sr, b * BEAT + BEAT / 4, 0.14)
      }
    },
  },
  {
    name: 'Bass',
    gain: 0.7,
    render: (data, sr) => {
      // Root-driven bassline walking A → A → C → E.
      const pat = [A1, A1, C3 / 2, E2]
      pat.forEach((f, b) => addNote(data, sr, b * BEAT, f, BEAT * 0.9, 0.5, 'square'))
    },
  },
  {
    name: 'Chords',
    gain: 0.4,
    render: (data, sr) => {
      // Sustained A-minor pad (two octaves) swelling across the bar.
      const chord = [A2, C3, E2 * 2, A3, C4, E4]
      chord.forEach((f) => addNote(data, sr, 0, f, BAR_SECONDS, 0.12, 'sine'))
    },
  },
]

/** Render every built-in loop into an AudioBuffer at the context's rate. */
export function renderLoops(ctx: BaseAudioContext): { name: string; gain: number; buffer: AudioBuffer }[] {
  const sr = ctx.sampleRate
  const length = Math.floor(BAR_SECONDS * sr)
  return LOOPS.map((loop) => {
    const buffer = ctx.createBuffer(1, length, sr)
    const data = buffer.getChannelData(0)
    loop.render(data, sr)
    return { name: loop.name, gain: loop.gain, buffer }
  })
}
