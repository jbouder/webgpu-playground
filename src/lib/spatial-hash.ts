import countSource from './spatial-hash-count.wgsl?raw'
import scanSource from './spatial-hash-scan.wgsl?raw'
import scatterSource from './spatial-hash-scatter.wgsl?raw'
import sharedSource from './spatial-hash.wgsl?raw'

/** Uniform-grid counting sort for up to 16,384 particles and 4,096 cells. */
export class SpatialHash {
  private readonly device: GPUDevice
  readonly particleCount: number
  readonly cellCounts: GPUBuffer
  readonly cellStarts: GPUBuffer
  readonly sortedIndices: GPUBuffer
  readonly gridUniform: GPUBuffer
  readonly cellCount: number
  private readonly countPipeline: GPUComputePipeline
  private readonly scanPipeline: GPUComputePipeline
  private readonly scatterPipeline: GPUComputePipeline
  private readonly countLayout: GPUBindGroupLayout
  private readonly scanLayout: GPUBindGroupLayout
  private readonly scatterLayout: GPUBindGroupLayout

  /**
   * Cells are x-major: x + y * dimensions.x + z * dimensions.x * dimensions.y.
   * The final cellStarts entry is a sentinel, making every cell range half-open.
   */
  constructor(
    device: GPUDevice,
    particleCount: number,
    cellSize: number,
    origin: [number, number, number] = [-8, -2, -8],
    dimensions: [number, number, number] = [16, 16, 16],
  ) {
    this.device = device
    this.particleCount = particleCount
    this.cellCount = dimensions[0] * dimensions[1] * dimensions[2]
    if (particleCount > 16_384 || this.cellCount > 4_096) {
      throw new Error(`spatial-hash limits exceeded: particles=${particleCount} (max 16,384), cells=${this.cellCount} (max 4,096)`)
    }
    const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    this.cellCounts = device.createBuffer({ label: 'spatial-hash-counts', size: this.cellCount * 4, usage: storage })
    this.cellStarts = device.createBuffer({ label: 'spatial-hash-starts', size: (this.cellCount + 1) * 4, usage: storage })
    this.sortedIndices = device.createBuffer({ label: 'spatial-hash-sorted-indices', size: particleCount * 4, usage: storage })
    this.gridUniform = device.createBuffer({ label: 'spatial-hash-grid', size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    const grid = new ArrayBuffer(32)
    const f = new Float32Array(grid)
    const u = new Uint32Array(grid)
    f.set([...origin, cellSize], 0)
    u.set([...dimensions, this.cellCount], 4)
    device.queue.writeBuffer(this.gridUniform, 0, grid)

    this.countLayout = device.createBindGroupLayout({ label: 'spatial-hash-count-layout', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] })
    this.scanLayout = device.createBindGroupLayout({ label: 'spatial-hash-scan-layout', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] })
    this.scatterLayout = device.createBindGroupLayout({ label: 'spatial-hash-scatter-layout', entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    ] })
    const module = (label: string, code: string) => device.createShaderModule({ label, code: sharedSource + code })
    this.countPipeline = device.createComputePipeline({ label: 'spatial-hash-count-pipeline', layout: device.createPipelineLayout({ bindGroupLayouts: [this.countLayout] }), compute: { module: module('spatial-hash-count-shader', countSource), entryPoint: 'main' } })
    this.scanPipeline = device.createComputePipeline({ label: 'spatial-hash-scan-pipeline', layout: device.createPipelineLayout({ bindGroupLayouts: [this.scanLayout] }), compute: { module: module('spatial-hash-scan-shader', scanSource), entryPoint: 'main' } })
    this.scatterPipeline = device.createComputePipeline({ label: 'spatial-hash-scatter-pipeline', layout: device.createPipelineLayout({ bindGroupLayouts: [this.scatterLayout] }), compute: { module: module('spatial-hash-scatter-shader', scatterSource), entryPoint: 'main' } })
  }

  build(encoder: GPUCommandEncoder, positions: GPUBuffer) {
    const count = this.device.createBindGroup({ label: 'spatial-hash-count-group', layout: this.countLayout, entries: [{ binding: 0, resource: { buffer: this.gridUniform } }, { binding: 1, resource: { buffer: positions } }, { binding: 2, resource: { buffer: this.cellCounts } }] })
    const scan = this.device.createBindGroup({ label: 'spatial-hash-scan-group', layout: this.scanLayout, entries: [{ binding: 0, resource: { buffer: this.gridUniform } }, { binding: 1, resource: { buffer: this.cellCounts } }, { binding: 2, resource: { buffer: this.cellStarts } }] })
    const scatter = this.device.createBindGroup({ label: 'spatial-hash-scatter-group', layout: this.scatterLayout, entries: [{ binding: 0, resource: { buffer: this.gridUniform } }, { binding: 1, resource: { buffer: positions } }, { binding: 2, resource: { buffer: this.cellStarts } }, { binding: 3, resource: { buffer: this.cellCounts } }, { binding: 4, resource: { buffer: this.sortedIndices } }] })
    encoder.clearBuffer(this.cellCounts)
    let pass = encoder.beginComputePass({ label: 'spatial-hash-count-pass' })
    pass.setPipeline(this.countPipeline); pass.setBindGroup(0, count); pass.dispatchWorkgroups(Math.ceil(this.particleCount / 64)); pass.end()
    pass = encoder.beginComputePass({ label: 'spatial-hash-scan-pass' })
    pass.setPipeline(this.scanPipeline); pass.setBindGroup(0, scan); pass.dispatchWorkgroups(1); pass.end()
    encoder.clearBuffer(this.cellCounts)
    pass = encoder.beginComputePass({ label: 'spatial-hash-scatter-pass' })
    pass.setPipeline(this.scatterPipeline); pass.setBindGroup(0, scatter); pass.dispatchWorkgroups(Math.ceil(this.particleCount / 64)); pass.end()
  }

  dispose() { this.cellCounts.destroy(); this.cellStarts.destroy(); this.sortedIndices.destroy(); this.gridUniform.destroy() }
}
