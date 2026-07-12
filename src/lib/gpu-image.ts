// Framework-agnostic GPU image-processing building blocks, reused across demos
// (image-lab, and the webcam pipeline). Nothing here touches React or the DOM
// beyond the WebGPU device it is handed.
//
// `ImagePipeline` owns two ping-pong rgba16float textures and runs an ordered
// chain of compute filter passes on whatever source (still image or video
// frame) you upload. `ImageBlitter` draws the result to a canvas with an
// aspect-preserving fit and an optional before/after wipe.

import filtersSource from './image-filters.wgsl?raw'
import blitSource from './image-blit.wgsl?raw'

/** Working/intermediate format. 16-bit float avoids banding across many passes
 *  and is both storage-writable and linearly filterable in core WebGPU. */
export const IMAGE_WORK_FORMAT: GPUTextureFormat = 'rgba16float'

/** All filter knobs. Neutral values (see {@link defaultFilters}) are an identity
 *  pipeline apart from the always-on color pass, which is itself neutral. */
export interface ImageFilters {
  /** Exposure in stops. 0 = unchanged. */
  brightness: number
  /** 1 = unchanged. */
  contrast: number
  /** 1 = unchanged, 0 = grayscale-by-desaturation. */
  saturation: number
  /** -1 cool … +1 warm. */
  temperature: number
  /** Gaussian blur radius in pixels (0 = off). */
  blur: number
  /** Unsharp amount (0 = off). */
  sharpen: number
  /** Sobel edge overlay mix, 0..1 (0 = off). */
  edges: number
  /** Vignette strength, 0..1 (0 = off). */
  vignette: number
  /** Desaturation mix, 0..1 (0 = off). */
  grayscale: number
}

export function defaultFilters(): ImageFilters {
  return {
    brightness: 0,
    contrast: 1,
    saturation: 1,
    temperature: 0,
    blur: 0,
    sharpen: 0,
    edges: 0,
    vignette: 0,
    grayscale: 0,
  }
}

/** Anything WebGPU can copy straight into a texture. */
export type ImageSource = ImageBitmap | HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | VideoFrame

const PARAM_FLOATS = 12
const MAX_BLUR = 40
const WG = 8

type PassName = 'color' | 'blur' | 'sharpen' | 'sobel' | 'vignette' | 'grayscale'

export class ImagePipeline {
  readonly device: GPUDevice
  private layout: GPUBindGroupLayout
  private pipelines: Record<PassName, GPUComputePipeline>
  // One uniform buffer per scheduled pass (blur runs twice, H then V).
  private buffers: Record<'color' | 'blurH' | 'blurV' | 'sharpen' | 'sobel' | 'vignette' | 'grayscale', GPUBuffer>
  private scratch = new Float32Array(PARAM_FLOATS)

  private original: GPUTexture | null = null
  private originalViewCache: GPUTextureView | null = null
  private work: [GPUTexture, GPUTexture] | null = null
  private workViews: [GPUTextureView, GPUTextureView] | null = null

  width = 0
  height = 0

  constructor(device: GPUDevice) {
    this.device = device

    const module = device.createShaderModule({ label: 'image-filters', code: filtersSource })

    this.layout = device.createBindGroupLayout({
      label: 'image-filter-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: IMAGE_WORK_FORMAT },
        },
      ],
    })
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] })

    const mkPipe = (entryPoint: PassName) =>
      device.createComputePipeline({
        label: `image-${entryPoint}`,
        layout: pipelineLayout,
        compute: { module, entryPoint },
      })
    this.pipelines = {
      color: mkPipe('color'),
      blur: mkPipe('blur'),
      sharpen: mkPipe('sharpen'),
      sobel: mkPipe('sobel'),
      vignette: mkPipe('vignette'),
      grayscale: mkPipe('grayscale'),
    }

    const mkBuf = (label: string) =>
      device.createBuffer({
        label: `image-uniform-${label}`,
        size: PARAM_FLOATS * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      })
    this.buffers = {
      color: mkBuf('color'),
      blurH: mkBuf('blurH'),
      blurV: mkBuf('blurV'),
      sharpen: mkBuf('sharpen'),
      sobel: mkBuf('sobel'),
      vignette: mkBuf('vignette'),
      grayscale: mkBuf('grayscale'),
    }
  }

  get ready(): boolean {
    return this.original !== null
  }

  /** View of the untouched source, for a before/after comparison. */
  get originalView(): GPUTextureView {
    if (!this.originalViewCache) throw new Error('ImagePipeline: no image uploaded yet')
    return this.originalViewCache
  }

  private ensureSize(w: number, h: number) {
    if (this.original && this.width === w && this.height === h) return
    this.destroyTextures()
    this.width = w
    this.height = h
    this.original = this.device.createTexture({
      label: 'image-original',
      size: [w, h],
      format: IMAGE_WORK_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.originalViewCache = this.original.createView()
    const mkWork = (i: number) =>
      this.device.createTexture({
        label: `image-work-${i}`,
        size: [w, h],
        format: IMAGE_WORK_FORMAT,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
      })
    this.work = [mkWork(0), mkWork(1)]
    this.workViews = [this.work[0].createView(), this.work[1].createView()]
  }

  /** Copy a still image or video frame into the source texture, resizing the
   *  internal textures if the dimensions changed. */
  upload(source: ImageSource, width: number, height: number) {
    this.ensureSize(width, height)
    this.device.queue.copyExternalImageToTexture(
      { source },
      { texture: this.original! },
      [width, height],
    )
  }

  private setParams(buf: GPUBuffer, entries: Record<number, number>) {
    this.scratch.fill(0)
    for (const k of Object.keys(entries)) {
      this.scratch[Number(k)] = entries[Number(k)]
    }
    this.device.queue.writeBuffer(buf, 0, this.scratch)
  }

  /** Encode every enabled filter pass, ping-ponging the work textures. Returns
   *  the view holding the final result (the always-on color pass guarantees at
   *  least one pass runs, so this is never the source texture). */
  run(encoder: GPUCommandEncoder, f: ImageFilters): GPUTextureView {
    if (!this.original || !this.workViews) throw new Error('ImagePipeline: no image uploaded yet')

    const passes: Array<{ pipe: GPUComputePipeline; buf: GPUBuffer }> = []

    this.setParams(this.buffers.color, {
      0: f.brightness,
      1: f.contrast,
      2: f.saturation,
      3: f.temperature,
    })
    passes.push({ pipe: this.pipelines.color, buf: this.buffers.color })

    if (f.blur >= 0.5) {
      const radius = Math.min(MAX_BLUR, f.blur)
      this.setParams(this.buffers.blurH, { 4: radius, 5: 1, 6: 0 })
      passes.push({ pipe: this.pipelines.blur, buf: this.buffers.blurH })
      this.setParams(this.buffers.blurV, { 4: radius, 5: 0, 6: 1 })
      passes.push({ pipe: this.pipelines.blur, buf: this.buffers.blurV })
    }
    if (f.sharpen > 0.001) {
      this.setParams(this.buffers.sharpen, { 7: f.sharpen })
      passes.push({ pipe: this.pipelines.sharpen, buf: this.buffers.sharpen })
    }
    if (f.edges > 0.001) {
      this.setParams(this.buffers.sobel, { 8: f.edges })
      passes.push({ pipe: this.pipelines.sobel, buf: this.buffers.sobel })
    }
    if (f.vignette > 0.001) {
      this.setParams(this.buffers.vignette, { 9: f.vignette })
      passes.push({ pipe: this.pipelines.vignette, buf: this.buffers.vignette })
    }
    if (f.grayscale > 0.001) {
      this.setParams(this.buffers.grayscale, { 10: f.grayscale })
      passes.push({ pipe: this.pipelines.grayscale, buf: this.buffers.grayscale })
    }

    const gx = Math.ceil(this.width / WG)
    const gy = Math.ceil(this.height / WG)
    let src = this.originalView
    let dst = 0

    for (const pass of passes) {
      const dstView = this.workViews[dst]
      const bindGroup = this.device.createBindGroup({
        layout: this.layout,
        entries: [
          { binding: 0, resource: { buffer: pass.buf } },
          { binding: 1, resource: src },
          { binding: 2, resource: dstView },
        ],
      })
      // One compute pass per step, so each kernel sees the previous kernel's
      // fully-written output (no reliance on intra-pass ordering).
      const cpass = encoder.beginComputePass()
      cpass.setPipeline(pass.pipe)
      cpass.setBindGroup(0, bindGroup)
      cpass.dispatchWorkgroups(gx, gy)
      cpass.end()
      src = dstView
      dst = 1 - dst
    }

    return src
  }

  private destroyTextures() {
    this.original?.destroy()
    this.work?.forEach((t) => t.destroy())
    this.original = null
    this.originalViewCache = null
    this.work = null
    this.workViews = null
  }

  dispose() {
    this.destroyTextures()
    for (const b of Object.values(this.buffers)) b.destroy()
  }
}

const BLIT_FLOATS = 8

/** Draws a processed image view to a canvas, aspect-fit, with an optional
 *  before/after wipe against the original. */
export class ImageBlitter {
  private device: GPUDevice
  private pipeline: GPURenderPipeline
  private layout: GPUBindGroupLayout
  private sampler: GPUSampler
  private buffer: GPUBuffer
  private scratch = new Float32Array(BLIT_FLOATS)

  constructor(device: GPUDevice, format: GPUTextureFormat) {
    this.device = device
    const module = device.createShaderModule({ label: 'image-blit', code: blitSource })

    this.layout = device.createBindGroupLayout({
      label: 'image-blit-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })

    this.pipeline = device.createRenderPipeline({
      label: 'image-blit-pipeline',
      layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list' },
    })

    this.sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    })
    this.buffer = device.createBuffer({
      label: 'image-blit-uniform',
      size: BLIT_FLOATS * 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /** @param split <0 shows the processed view everywhere; 0..1 wipes the
   *  original in on the left up to that fraction of the canvas width.
   *  @param mirror >0.5 flips the image horizontally (selfie view). */
  draw(
    encoder: GPUCommandEncoder,
    target: GPUTextureView,
    canvasW: number,
    canvasH: number,
    imageW: number,
    imageH: number,
    originalView: GPUTextureView,
    processedView: GPUTextureView,
    split: number,
    mirror = 0,
  ) {
    this.scratch[0] = canvasW
    this.scratch[1] = canvasH
    this.scratch[2] = imageW
    this.scratch[3] = imageH
    this.scratch[4] = split
    this.scratch[5] = mirror
    this.device.queue.writeBuffer(this.buffer, 0, this.scratch)

    const bindGroup = this.device.createBindGroup({
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.buffer } },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: originalView },
        { binding: 3, resource: processedView },
      ],
    })

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target,
          clearValue: { r: 0.03, g: 0.04, b: 0.06, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
  }

  dispose() {
    this.buffer.destroy()
  }
}
