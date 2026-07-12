import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import shaderSource from './raymarch.wgsl?raw'

// Uniform layout (std140-ish). 24 floats = 96 bytes, 16-byte aligned:
//   [0,1]   resolution.xy
//   [2]     time
//   [3]     tanHalfFov
//   [4,5,6] rayOrigin.xyz
//   [7]     steps
//   [8,9,10] forward.xyz
//   [11]    densityScale
//   [12,13,14] right.xyz
//   [15]    hue
//   [16,17,18] up.xyz
//   [19]    fresnel
//   [20]    scanlines
//   [21]    chroma
//   [22]    flicker
//   [23]    padding
const UNIFORM_FLOATS = 24
const UNIFORM_BYTES = UNIFORM_FLOATS * 4

export interface HolotableParams {
  autoRotate: boolean
  steps: number
  densityScale: number
  hue: number
  fresnel: number
  scanlines: number
  chroma: number
  flicker: number
  yaw: number
  pitch: number
  distance: number
}

export interface HolotableInstance extends DemoInstance {
  params: HolotableParams
  resetCamera(): void
}

const normalize = (v: [number, number, number]): [number, number, number] => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

const cross = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

export async function init(ctx: DemoContext): Promise<HolotableInstance> {
  const { device, context, format, canvas } = ctx
  const module = device.createShaderModule({
    label: 'holotable-shader',
    code: shaderSource,
  })
  const uniformBuffer = device.createBuffer({
    label: 'holotable-uniforms',
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const pipeline = device.createRenderPipeline({
    label: 'holotable-pipeline',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const bindGroup = device.createBindGroup({
    label: 'holotable-bindgroup',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  })

  const params: HolotableParams = {
    autoRotate: true,
    steps: 96,
    densityScale: 1,
    hue: 0.5,
    fresnel: 0.8,
    scanlines: 0.6,
    chroma: 0.45,
    flicker: 0.3,
    yaw: 0.5,
    pitch: 0.25,
    distance: 3.2,
  }
  const uniforms = new Float32Array(UNIFORM_FLOATS)
  let dragging = false
  let pointerX = 0
  let pointerY = 0
  let disposed = false

  const pointerPosition = (event: PointerEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / Math.max(rect.width, 1)
    const scaleY = canvas.height / Math.max(rect.height, 1)
    return [
      (event.clientX - rect.left) * scaleX,
      (event.clientY - rect.top) * scaleY,
    ]
  }
  const onPointerDown = (event: PointerEvent) => {
    ;[pointerX, pointerY] = pointerPosition(event)
    dragging = true
    canvas.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: PointerEvent) => {
    const [nextX, nextY] = pointerPosition(event)
    if (dragging) {
      params.yaw += (nextX - pointerX) * 0.008
      params.pitch = Math.max(-1.35, Math.min(1.35, params.pitch - (nextY - pointerY) * 0.008))
    }
    pointerX = nextX
    pointerY = nextY
  }
  const onPointerUp = (event: PointerEvent) => {
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId)
    }
  }
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)

  const resetCamera = () => {
    params.yaw = 0.5
    params.pitch = 0.25
    params.distance = 3.2
  }

  const frame = (dt: number, elapsed: number) => {
    if (disposed) return
    if (params.autoRotate) params.yaw += dt * 0.28

    const cosPitch = Math.cos(params.pitch)
    const origin: [number, number, number] = [
      Math.sin(params.yaw) * cosPitch * params.distance,
      Math.sin(params.pitch) * params.distance,
      Math.cos(params.yaw) * cosPitch * params.distance,
    ]
    const forward = normalize([-origin[0], -origin[1], -origin[2]])
    const right = normalize(cross(forward, [0, 1, 0]))
    const up = normalize(cross(right, forward))

    uniforms.set([
      canvas.width,
      canvas.height,
      elapsed,
      Math.tan(Math.PI / 8),
      origin[0],
      origin[1],
      origin[2],
      params.steps,
      forward[0],
      forward[1],
      forward[2],
      params.densityScale,
      right[0],
      right[1],
      right[2],
      params.hue,
      up[0],
      up[1],
      up[2],
      params.fresnel,
      params.scanlines,
      params.chroma,
      params.flicker,
      0,
    ])
    device.queue.writeBuffer(uniformBuffer, 0, uniforms)

    const encoder = device.createCommandEncoder({ label: 'holotable-frame' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    canvas.removeEventListener('pointerdown', onPointerDown)
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
    uniformBuffer.destroy()
  }

  return { params, resetCamera, frame, dispose }
}

export const holotableDemo: Demo = {
  id: 'holotable',
  title: 'Holotable',
  description:
    'A volumetric hologram: an SDF density field raymarched front-to-back and shaded with fresnel edges, scanlines, and chromatic drift. Drag to orbit.',
  init,
}
