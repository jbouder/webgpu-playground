import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import {
  defaultFilters,
  ImageBlitter,
  ImagePipeline,
  type ImageFilters,
} from '../../lib/gpu-image'

/** Extra surface the Controls panel pokes. GPU state lives here, not in React. */
export interface ImageLabInstance extends DemoInstance {
  /** All filter knobs, plus the before/after wipe position (<0 = disabled). */
  params: ImageFilters & { split: number }
  /** Decode + upload a user-picked image file. Rejects if it can't decode. */
  loadFile(file: File): Promise<void>
  /** Restore the neutral (identity) filter chain. */
  reset(): void
  /** Signal that a filter param changed and the chain must be re-run. */
  markDirty(): void
  /** Current source dimensions, for display. */
  readonly info: { width: number; height: number }
  /** Set by Controls to learn when a new image finishes loading. */
  onImageChange: (() => void) | null
}

// Cap the working resolution so huge uploads don't blow up VRAM or frame time.
const MAX_DIM = 2048

interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
}

/** Decode a blob to an ImageBitmap, downscaling if it exceeds MAX_DIM. */
async function decode(blob: Blob): Promise<LoadedImage> {
  const probe = await createImageBitmap(blob)
  const { width, height } = probe
  const scale = Math.min(1, MAX_DIM / Math.max(width, height))
  if (scale >= 1) return { bitmap: probe, width, height }

  const w = Math.round(width * scale)
  const h = Math.round(height * scale)
  probe.close()
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: w,
    resizeHeight: h,
    resizeQuality: 'high',
  })
  return { bitmap, width: w, height: h }
}

/** A synthetic photo-ish sample so the demo is populated on load: a color
 *  gradient, soft bokeh discs, a hard-edged bar chart (for sharpen/edges),
 *  bold type, and fine noise. Purely CPU 2D-canvas work. */
async function makeSampleImage(): Promise<LoadedImage> {
  const width = 1280
  const height = 854
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const g = c.getContext('2d')
  if (!g) throw new Error('2D canvas unavailable')

  const grad = g.createLinearGradient(0, 0, width, height)
  grad.addColorStop(0, '#ff9a5a')
  grad.addColorStop(0.5, '#c04fd0')
  grad.addColorStop(1, '#2a6cf0')
  g.fillStyle = grad
  g.fillRect(0, 0, width, height)

  // Soft translucent discs — low-frequency detail that blurs beautifully.
  const discs = [
    [260, 220, 170, '#ffd38a'],
    [980, 200, 210, '#7ce7ff'],
    [1080, 640, 150, '#ffffff'],
    [420, 660, 130, '#b6ff9e'],
  ] as const
  for (const [x, y, r, col] of discs) {
    g.globalAlpha = 0.5
    g.fillStyle = col
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fill()
  }
  g.globalAlpha = 1

  // Hard-edged bars — high-frequency detail for sharpen / edge detection.
  const barY = height - 150
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 === 0 ? '#0b0d12' : '#f2f4f8'
    g.fillRect(60 + i * 44, barY, 30, 110)
  }

  g.fillStyle = 'rgba(255,255,255,0.92)'
  g.font = 'bold 128px ui-sans-serif, system-ui, sans-serif'
  g.fillText('WebGPU', 60, 200)
  g.fillStyle = 'rgba(11,13,18,0.75)'
  g.font = '600 44px ui-sans-serif, system-ui, sans-serif'
  g.fillText('image lab', 64, 260)

  // Fine luminance noise so grain-sensitive filters have something to chew on.
  const noise = g.getImageData(0, 0, width, height)
  const d = noise.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 22
    d[i] += n
    d[i + 1] += n
    d[i + 2] += n
  }
  g.putImageData(noise, 0, 0)

  const bitmap = await createImageBitmap(c)
  return { bitmap, width, height }
}

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx

  const pipeline = new ImagePipeline(device)
  const blitter = new ImageBlitter(device, format)

  const params: ImageFilters & { split: number } = { ...defaultFilters(), split: -1 }
  const info = { width: 0, height: 0 }

  let dirty = true
  let resultView: GPUTextureView | null = null
  let onImageChange: (() => void) | null = null

  const applyImage = (img: LoadedImage) => {
    pipeline.upload(img.bitmap, img.width, img.height)
    img.bitmap.close()
    info.width = img.width
    info.height = img.height
    // The old result view points at a (possibly destroyed) texture; recompute.
    resultView = null
    dirty = true
    onImageChange?.()
  }

  // Populate immediately with the synthetic sample.
  applyImage(await makeSampleImage())

  const frame = () => {
    if (!pipeline.ready) return
    const encoder = device.createCommandEncoder({ label: 'image-lab-frame' })
    // Re-run the filter chain only when something changed; the work textures
    // retain the result between frames, so the blit is all that's needed otherwise.
    if (dirty || !resultView) {
      resultView = pipeline.run(encoder, params)
      dirty = false
    }
    blitter.draw(
      encoder,
      context.getCurrentTexture().createView(),
      canvas.width,
      canvas.height,
      info.width,
      info.height,
      pipeline.originalView,
      resultView,
      params.split,
    )
    device.queue.submit([encoder.finish()])
  }

  const instance: ImageLabInstance = {
    frame,
    dispose() {
      pipeline.dispose()
      blitter.dispose()
    },
    params,
    async loadFile(file: File) {
      applyImage(await decode(file))
    },
    reset() {
      Object.assign(params, defaultFilters(), { split: -1 })
      dirty = true
    },
    markDirty() {
      dirty = true
    },
    get info() {
      return info
    },
    get onImageChange() {
      return onImageChange
    },
    set onImageChange(fn: (() => void) | null) {
      onImageChange = fn
    },
  }
  return instance
}

// React-free: the registry attaches the Controls component.
export const imageLabDemo: Demo = {
  id: 'image-lab',
  title: 'Image Lab',
  description:
    'Upload an image and stack GPU compute filters — exposure, contrast, saturation, gaussian blur, unsharp, Sobel edges, vignette. Each filter is a compute pass over ping-pong rgba16float textures; drag the before/after split to compare. The pipeline (lib/gpu-image.ts) is reused by the webcam demo.',
  init,
}
