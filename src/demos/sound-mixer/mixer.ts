import { renderLoops } from './loops'

/**
 * React-free multi-track sound mixer. Each track is an AudioBuffer routed
 * through its own gain → pan node into a shared master bus; the master feeds an
 * AnalyserNode (for the visualizer) before the destination:
 *
 *   source → gain → pan ─┐
 *   source → gain → pan ─┼→ master gain → analyser → destination
 *   source → gain → pan ─┘
 *
 * Transport loops all tracks off one shared start time so they stay
 * phase-locked. State lives here (the render loop / analyser is the source of
 * truth); the React Controls mirror it via `onChange`.
 */

export interface TrackState {
  id: string
  name: string
  /** Fader, 0..1.5. */
  gain: number
  /** Stereo pan, -1 (L) .. 1 (R). */
  pan: number
  muted: boolean
  soloed: boolean
  /** Built-in loops can't be removed; uploaded tracks can. */
  removable: boolean
}

interface Track {
  state: TrackState
  buffer: AudioBuffer
  gainNode: GainNode
  panNode: StereoPannerNode
  source: AudioBufferSourceNode | null
}

const RAMP = 0.02 // seconds — short fade to avoid zipper noise on fader moves

export class SoundMixer {
  readonly ctx: AudioContext
  readonly analyser: AnalyserNode
  private masterGain: GainNode
  private tracks = new Map<string, Track>()
  private nextId = 1
  private startTime = 0

  playing = false
  masterVolume = 0.9

  /** Fired whenever track list / transport state changes (React re-render). */
  onChange: (() => void) | null = null

  constructor(fftSize = 512) {
    this.ctx = new AudioContext()
    this.masterGain = this.ctx.createGain()
    this.masterGain.gain.value = this.masterVolume

    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = fftSize
    this.analyser.smoothingTimeConstant = 0.8

    this.masterGain.connect(this.analyser)
    this.analyser.connect(this.ctx.destination)
  }

  /** Populate the built-in procedural loops. Call once after construction. */
  loadBuiltins(): void {
    for (const loop of renderLoops(this.ctx)) {
      this.addTrack(loop.name, loop.buffer, { gain: loop.gain, removable: false })
    }
  }

  get trackList(): TrackState[] {
    return [...this.tracks.values()].map((t) => t.state)
  }

  addTrack(name: string, buffer: AudioBuffer, opts: { gain?: number; removable?: boolean } = {}): string {
    const id = `t${this.nextId++}`
    const gainNode = this.ctx.createGain()
    const panNode = this.ctx.createStereoPanner()
    gainNode.connect(panNode)
    panNode.connect(this.masterGain)

    const state: TrackState = {
      id,
      name,
      gain: opts.gain ?? 0.8,
      pan: 0,
      muted: false,
      soloed: false,
      removable: opts.removable ?? true,
    }
    this.tracks.set(id, { state, buffer, gainNode, panNode, source: null })
    this.applyGains()

    // If we're already playing, start the new track in sync with the loop.
    if (this.playing) this.startSource(id)
    this.onChange?.()
    return id
  }

  /** Decode an uploaded audio file and add it as a removable track. */
  async addTrackFromFile(file: File): Promise<void> {
    const data = await file.arrayBuffer()
    const buffer = await this.ctx.decodeAudioData(data)
    const name = file.name.replace(/\.[^.]+$/, '').slice(0, 24)
    this.addTrack(name || 'Track', buffer, { gain: 0.8, removable: true })
  }

  removeTrack(id: string): void {
    const track = this.tracks.get(id)
    if (!track) return
    track.source?.stop()
    track.source?.disconnect()
    track.gainNode.disconnect()
    track.panNode.disconnect()
    this.tracks.delete(id)
    this.applyGains()
    this.onChange?.()
  }

  setGain(id: string, value: number): void {
    const track = this.tracks.get(id)
    if (!track) return
    track.state.gain = value
    this.applyGains()
    this.onChange?.()
  }

  setPan(id: string, value: number): void {
    const track = this.tracks.get(id)
    if (!track) return
    track.state.pan = value
    track.panNode.pan.setTargetAtTime(value, this.ctx.currentTime, RAMP)
    this.onChange?.()
  }

  toggleMute(id: string): void {
    const track = this.tracks.get(id)
    if (!track) return
    track.state.muted = !track.state.muted
    this.applyGains()
    this.onChange?.()
  }

  toggleSolo(id: string): void {
    const track = this.tracks.get(id)
    if (!track) return
    track.state.soloed = !track.state.soloed
    this.applyGains()
    this.onChange?.()
  }

  setMasterVolume(value: number): void {
    this.masterVolume = value
    this.masterGain.gain.setTargetAtTime(value, this.ctx.currentTime, RAMP)
    this.onChange?.()
  }

  // Fold mute + solo into each track's effective gain. Any soloed track mutes
  // every non-soloed one.
  private applyGains(): void {
    const anySolo = [...this.tracks.values()].some((t) => t.state.soloed)
    const now = this.ctx.currentTime
    for (const t of this.tracks.values()) {
      const audible = !t.state.muted && (!anySolo || t.state.soloed)
      const target = audible ? t.state.gain : 0
      t.gainNode.gain.setTargetAtTime(target, now, RAMP)
    }
  }

  private startSource(id: string, when = this.startTime): void {
    const track = this.tracks.get(id)
    if (!track) return
    track.source?.stop()
    const src = this.ctx.createBufferSource()
    src.buffer = track.buffer
    src.loop = true
    src.connect(track.gainNode)
    // Offset into the loop by how far the transport has already run, so a
    // late-added track drops in on the beat rather than at bar zero.
    const elapsed = when <= this.ctx.currentTime ? (this.ctx.currentTime - this.startTime) % track.buffer.duration : 0
    src.start(Math.max(when, this.ctx.currentTime), elapsed)
    track.source = src
  }

  play(): void {
    void this.ctx.resume()
    if (this.playing) return
    this.playing = true
    this.startTime = this.ctx.currentTime + 0.06
    for (const id of this.tracks.keys()) this.startSource(id)
    this.onChange?.()
  }

  stop(): void {
    if (!this.playing) return
    this.playing = false
    for (const t of this.tracks.values()) {
      t.source?.stop()
      t.source?.disconnect()
      t.source = null
    }
    this.onChange?.()
  }

  toggleTransport(): void {
    if (this.playing) this.stop()
    else this.play()
  }

  dispose(): void {
    this.stop()
    void this.ctx.close()
  }
}
