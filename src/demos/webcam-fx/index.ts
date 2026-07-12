import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import {
  defaultFilters,
  ImageBlitter,
  ImagePipeline,
  type ImageFilters,
} from '../../lib/gpu-image'

/** Extra surface the Controls panel pokes. GPU + camera state lives here. */
export interface WebcamFxInstance extends DemoInstance {
  /** Filter knobs (shared with image-lab) plus webcam-specific view options. */
  params: ImageFilters & { split: number; mirror: boolean }
  /** Restore neutral filters (keeps mirror/split view options). */
  reset(): void
  /** Download the current processed frame as a PNG. */
  snapshot(): void
  /** Live-feed dimensions, once the camera is streaming. */
  readonly info: { width: number; height: number }
}

/** Turn a getUserMedia rejection into a message worth showing the user. */
function cameraErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was blocked. Allow camera permission for this site, then click Retry.'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.'
    case 'NotReadableError':
      return 'The camera is in use by another application.'
    default:
      return err instanceof Error ? err.message : 'Could not start the camera.'
  }
}

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser does not expose camera access (getUserMedia).')
  }

  const pipeline = new ImagePipeline(device)
  const blitter = new ImageBlitter(device, format)

  const params: ImageFilters & { split: number; mirror: boolean } = {
    ...defaultFilters(),
    split: -1,
    mirror: true, // selfie default
  }
  const info = { width: 0, height: 0 }

  // --- Camera setup. A rejection here propagates out of init(), which the host
  // surfaces as an error overlay with a Retry that re-prompts. ---
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    })
  } catch (err) {
    pipeline.dispose()
    blitter.dispose()
    throw new Error(cameraErrorMessage(err))
  }

  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.autoplay = true
  video.srcObject = stream

  const stopCamera = () => {
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('The camera stream failed to load.'))
    })
    await video.play()
  } catch (err) {
    stopCamera()
    pipeline.dispose()
    blitter.dispose()
    throw err
  }

  info.width = video.videoWidth
  info.height = video.videoHeight

  let resultView: GPUTextureView | null = null
  let pendingSnapshot = false

  const frame = () => {
    // A live feed re-runs the whole chain every frame — always "dirty".
    if (!stream.active || video.readyState < 2 || video.videoWidth === 0) return
    const w = video.videoWidth
    const h = video.videoHeight
    info.width = w
    info.height = h

    pipeline.upload(video, w, h)

    const encoder = device.createCommandEncoder({ label: 'webcam-fx-frame' })
    resultView = pipeline.run(encoder, params)
    blitter.draw(
      encoder,
      context.getCurrentTexture().createView(),
      canvas.width,
      canvas.height,
      w,
      h,
      pipeline.originalView,
      resultView,
      params.split,
      params.mirror ? 1 : 0,
    )
    device.queue.submit([encoder.finish()])

    // Grab the PNG after a frame has actually been presented.
    if (pendingSnapshot) {
      pendingSnapshot = false
      canvas.toBlob((blob) => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'webcam-fx.png'
        a.click()
        URL.revokeObjectURL(url)
      }, 'image/png')
    }
  }

  const instance: WebcamFxInstance = {
    frame,
    dispose() {
      stopCamera()
      pipeline.dispose()
      blitter.dispose()
    },
    params,
    reset() {
      Object.assign(params, defaultFilters())
    },
    snapshot() {
      pendingSnapshot = true
    },
    get info() {
      return info
    },
  }
  return instance
}

// React-free: the registry attaches the Controls component.
export const webcamFxDemo: Demo = {
  id: 'webcam-fx',
  title: 'Webcam FX',
  description:
    'Real-time GPU effects on your live camera feed. Each frame is copied into a texture and pushed through the same compute filter chain as Image Lab (lib/gpu-image.ts) — exposure, blur, unsharp, Sobel edges, vignette, grayscale — then blitted with an optional before/after split. Mirror the view and snapshot a PNG. Nothing leaves the browser.',
  init,
}
