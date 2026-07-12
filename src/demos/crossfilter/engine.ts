import aggregateSource from './aggregate.wgsl?raw'
import { BINS, DIMENSIONS, generatePackedRows } from './data'

/**
 * React-free crossfilter engine. Owns the columnar row buffer, the GPU
 * aggregate buffers, and the brush state, and orchestrates the aggregation
 * pass. The render module reads its `hist1d` / `density` buffers directly each
 * frame; the CPU mirror (populated by an occasional readback) backs tooltips.
 *
 * Framework-agnostic — the strongest candidate to lift into a monitoring app.
 */

const N_DIMS = DIMENSIONS.length // 4 brushable 1D panels
const HIST_LEN = N_DIMS * BINS
const DENSITY_LEN = BINS * BINS
const WG = 256

export type Brush = { lo: number; hi: number } | null

export class CrossfilterEngine {
  private device: GPUDevice
  private rowBuffer: GPUBuffer | null = null
  private n = 0

  readonly hist1d: GPUBuffer
  readonly density: GPUBuffer
  private filterBuffer: GPUBuffer
  private staging: GPUBuffer

  private pipeline: GPUComputePipeline
  private bindGroup: GPUBindGroup | null = null

  private readonly zeroHist = new Uint32Array(HIST_LEN)
  private readonly zeroDensity = new Uint32Array(DENSITY_LEN)
  private readonly filterData = new Uint32Array(12)

  /** One brush per 1D dimension (null = no filter on that panel). */
  brushes: Brush[] = new Array(N_DIMS).fill(null)

  // CPU mirror (from readback) + fixed normalization maxes computed at load.
  private histMirror = new Uint32Array(HIST_LEN)
  private densityMirror = new Uint32Array(DENSITY_LEN)
  baseMax: number[] = new Array(N_DIMS + 1).fill(1)
  private readbackPending = false

  constructor(device: GPUDevice) {
    this.device = device
    this.hist1d = device.createBuffer({
      label: 'xf-hist1d',
      size: HIST_LEN * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    this.density = device.createBuffer({
      label: 'xf-density',
      size: DENSITY_LEN * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    })
    this.filterBuffer = device.createBuffer({
      label: 'xf-filter',
      size: this.filterData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.staging = device.createBuffer({
      label: 'xf-readback',
      size: (HIST_LEN + DENSITY_LEN) * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    })

    const module = device.createShaderModule({ label: 'xf-aggregate', code: aggregateSource })
    this.pipeline = device.createComputePipeline({
      label: 'xf-aggregate-pipeline',
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    })
  }

  get rowCount(): number {
    return this.n
  }

  /** Generate + upload a fresh dataset, then aggregate and capture base maxes. */
  async setData(n: number): Promise<void> {
    const rows = generatePackedRows(n)
    this.rowBuffer?.destroy()
    this.rowBuffer = this.device.createBuffer({
      label: 'xf-rows',
      size: rows.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.device.queue.writeBuffer(this.rowBuffer, 0, rows)
    this.n = n

    this.bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.rowBuffer } },
        { binding: 1, resource: { buffer: this.filterBuffer } },
        { binding: 2, resource: { buffer: this.hist1d } },
        { binding: 3, resource: { buffer: this.density } },
      ],
    })

    this.brushes.fill(null)
    this.recompute()
    // Capture the unfiltered maxes as fixed normalizers so bars shrink (rather
    // than rescale) as filters narrow.
    await this.readback()
    for (let p = 0; p < N_DIMS; p++) {
      let m = 1
      for (let b = 0; b < BINS; b++) m = Math.max(m, this.histMirror[p * BINS + b])
      this.baseMax[p] = m
    }
    let dm = 1
    for (let i = 0; i < DENSITY_LEN; i++) dm = Math.max(dm, this.densityMirror[i])
    this.baseMax[N_DIMS] = dm
  }

  setBrush(dim: number, brush: Brush): void {
    this.brushes[dim] = brush
    this.recompute()
  }

  clearAll(): void {
    this.brushes.fill(null)
    this.recompute()
  }

  get activeBrushCount(): number {
    return this.brushes.filter(Boolean).length
  }

  /** Run one aggregation pass over the dataset for the current brush set. */
  recompute(): void {
    if (!this.rowBuffer || !this.bindGroup) return

    // A null brush becomes the full [0, BINS-1] range, which passes everything.
    this.filterData[0] = this.n
    for (let d = 0; d < N_DIMS; d++) {
      const b = this.brushes[d]
      this.filterData[1 + d * 2] = b ? b.lo : 0
      this.filterData[2 + d * 2] = b ? b.hi : BINS - 1
    }
    this.device.queue.writeBuffer(this.filterBuffer, 0, this.filterData)

    // Clear the atomic accumulators, then scatter.
    this.device.queue.writeBuffer(this.hist1d, 0, this.zeroHist)
    this.device.queue.writeBuffer(this.density, 0, this.zeroDensity)

    const encoder = this.device.createCommandEncoder({ label: 'xf-recompute' })
    const pass = encoder.beginComputePass()
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, this.bindGroup)
    pass.dispatchWorkgroups(Math.ceil(this.n / WG))
    pass.end()
    this.device.queue.submit([encoder.finish()])
  }

  /** Copy the aggregate buffers back to the CPU mirror (for tooltips/base max). */
  async readback(): Promise<void> {
    if (this.readbackPending) return
    this.readbackPending = true
    const encoder = this.device.createCommandEncoder({ label: 'xf-readback' })
    encoder.copyBufferToBuffer(this.hist1d, 0, this.staging, 0, HIST_LEN * 4)
    encoder.copyBufferToBuffer(this.density, 0, this.staging, HIST_LEN * 4, DENSITY_LEN * 4)
    this.device.queue.submit([encoder.finish()])
    try {
      await this.staging.mapAsync(GPUMapMode.READ)
      const view = new Uint32Array(this.staging.getMappedRange())
      this.histMirror.set(view.subarray(0, HIST_LEN))
      this.densityMirror.set(view.subarray(HIST_LEN, HIST_LEN + DENSITY_LEN))
      this.staging.unmap()
    } finally {
      this.readbackPending = false
    }
  }

  /** Exact count for a 1D panel bin (from the last readback). */
  countAt(panel: number, bin: number): number {
    if (panel < N_DIMS) return this.histMirror[panel * BINS + bin] ?? 0
    return 0
  }

  /** Total rows passing the current compound filter (sum of scatter density). */
  filteredTotal(): number {
    let sum = 0
    for (let i = 0; i < DENSITY_LEN; i++) sum += this.densityMirror[i]
    return sum
  }

  dispose(): void {
    this.rowBuffer?.destroy()
    this.hist1d.destroy()
    this.density.destroy()
    this.filterBuffer.destroy()
    this.staging.destroy()
  }
}
