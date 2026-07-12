/**
 * Bridge between the Web Audio `AnalyserNode` and the GPU. Each frame it pulls
 * the FFT (frequency bins) off the analyser, normalizes it to 0..1, computes
 * coarse bass/mid/treble bands on the CPU, and uploads the spectrum to a
 * storage buffer any demo pipeline can bind and read in WGSL.
 *
 * Framework-agnostic on purpose — no React, no direct GPU ownership beyond the
 * one buffer it manages. Reusable by any audio-aware visual demo.
 */

export interface AudioBands {
  /** Low-frequency energy, 0..1 (kick / bass). */
  bass: number
  /** Mid-frequency energy, 0..1 (vocals / body). */
  mid: number
  /** High-frequency energy, 0..1 (hats / air). */
  treble: number
  /** Overall level across all bins, 0..1. */
  level: number
}

// Band split points as fractions of the usable bin range. Music energy skews
// low, so bass gets a narrow slice and treble a wide one.
const BASS_END = 0.08
const MID_END = 0.4

export class AudioAnalyserBridge {
  /** Number of usable frequency bins (fftSize / 2). */
  readonly bins: number
  private analyser: AnalyserNode
  // Explicit ArrayBuffer backing: getByteFrequencyData rejects a possibly-shared
  // buffer under TS's typed-array generics.
  private bytes: Uint8Array<ArrayBuffer>
  private normalized: Float32Array
  private buffer: GPUBuffer | null = null
  private device: GPUDevice | null = null

  bands: AudioBands = { bass: 0, mid: 0, treble: 0, level: 0 }

  constructor(analyser: AnalyserNode) {
    this.analyser = analyser
    this.bins = analyser.frequencyBinCount
    this.bytes = new Uint8Array(new ArrayBuffer(this.bins))
    this.normalized = new Float32Array(this.bins)
  }

  /** The GPU spectrum buffer. Call `writeToGPU` at least once first. */
  get freqBuffer(): GPUBuffer {
    if (!this.buffer) throw new Error('freqBuffer not created yet — call writeToGPU first')
    return this.buffer
  }

  /** Read-only view of the current normalized spectrum (CPU side). */
  get spectrum(): Float32Array {
    return this.normalized
  }

  private ensureBuffer(device: GPUDevice): GPUBuffer {
    if (this.buffer && this.device === device) return this.buffer
    this.buffer?.destroy()
    this.device = device
    this.buffer = device.createBuffer({
      label: 'audio-spectrum',
      size: this.bins * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    return this.buffer
  }

  /** Pull the FFT off the analyser and recompute the band aggregates. */
  update(): void {
    this.analyser.getByteFrequencyData(this.bytes)
    const n = this.bins
    const bassEnd = Math.max(1, Math.floor(n * BASS_END))
    const midEnd = Math.max(bassEnd + 1, Math.floor(n * MID_END))

    let bass = 0
    let mid = 0
    let treble = 0
    let sum = 0
    for (let i = 0; i < n; i++) {
      const v = this.bytes[i] / 255
      this.normalized[i] = v
      sum += v
      if (i < bassEnd) bass += v
      else if (i < midEnd) mid += v
      else treble += v
    }
    this.bands = {
      bass: bass / bassEnd,
      mid: mid / (midEnd - bassEnd),
      treble: treble / (n - midEnd),
      level: sum / n,
    }
  }

  /** Upload the current normalized spectrum to the GPU storage buffer. */
  writeToGPU(device: GPUDevice): void {
    const buf = this.ensureBuffer(device)
    device.queue.writeBuffer(buf, 0, this.normalized)
  }

  dispose(): void {
    this.buffer?.destroy()
    this.buffer = null
    this.device = null
  }
}
