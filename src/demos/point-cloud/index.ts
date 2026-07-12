import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import { OrbitCamera } from './camera'
import shaderSource from './shader.wgsl?raw'

/** Extra surface the Controls panel pokes. GPU state lives here, not in React. */
export interface PointCloudInstance extends DemoInstance {
  readonly maxPoints: number
  params: {
    pointSize: number
    autoRotate: boolean
    spinSpeed: number
    /** How many of the generated points to draw (slider-controlled). */
    activePoints: number
  }
}

export const FLOATS_PER_POINT = 6 // x,y,z, r,g,b
export const POINT_STRIDE = FLOATS_PER_POINT * 4
// Generate the maximum up front; the slider just changes how many we draw.
export const MAX_POINTS = 1_000_000
export const DEFAULT_POINTS = 300_000
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus'

// Uniforms: mat4 (16) + resolution.xy (2) + pointSize (1) + pad (1) = 20 floats.
const UNIFORM_FLOATS = 20
const UNIFORM_BYTES = UNIFORM_FLOATS * 4

/** Standard-normal-ish sample (sum of uniforms → cheap bell curve). */
function randn(): number {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 0.9
}

/** A procedural spiral-galaxy cloud: dense warm core, cool scattered arms. */
export function generateGalaxy(count: number): Float32Array {
  const data = new Float32Array(count * FLOATS_PER_POINT)
  const arms = 4
  const coreWarm = [1.0, 0.82, 0.55]
  const midWhite = [0.72, 0.8, 1.0]
  const outerBlue = [0.38, 0.5, 0.95]

  for (let i = 0; i < count; i++) {
    const radius = Math.pow(Math.random(), 0.5) * 5
    const armAngle = ((i % arms) / arms) * Math.PI * 2
    const angle = armAngle + radius * 0.85 + randn() * 0.35
    const scatter = randn() * (0.12 + radius * 0.06)

    const x = Math.cos(angle) * radius + scatter
    const z = Math.sin(angle) * radius + scatter
    // Thin disk, thicker toward the core.
    const y = randn() * 0.18 * (1 / (1 + radius * 0.4))

    // Color by radius: core → mid → outer, with brightness jitter.
    const t = Math.min(radius / 5, 1)
    const a = t < 0.5 ? coreWarm : midWhite
    const b = t < 0.5 ? midWhite : outerBlue
    const lt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5
    const bright = 0.7 + Math.random() * 0.5

    const o = i * FLOATS_PER_POINT
    data[o + 0] = x
    data[o + 1] = y
    data[o + 2] = z
    data[o + 3] = (a[0] + (b[0] - a[0]) * lt) * bright
    data[o + 4] = (a[1] + (b[1] - a[1]) * lt) * bright
    data[o + 5] = (a[2] + (b[2] - a[2]) * lt) * bright
  }
  return data
}

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx

  const module = device.createShaderModule({ label: 'point-cloud', code: shaderSource })

  // Generate the max set once; draw a slider-controlled subset each frame.
  const points = generateGalaxy(MAX_POINTS)
  const instanceBuffer = device.createBuffer({
    label: 'point-instances',
    size: points.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(instanceBuffer, 0, points)

  const uniformBuffer = device.createBuffer({
    label: 'point-uniforms',
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const pipeline = device.createRenderPipeline({
    label: 'point-cloud-pipeline',
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        {
          arrayStride: POINT_STRIDE,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x3' },
          ],
        },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: 'less',
    },
  })

  const bindGroup = device.createBindGroup({
    label: 'point-cloud-bindgroup',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  })

  const camera = new OrbitCamera()
  const detachCamera = camera.attach(canvas)

  const uniforms = new Float32Array(UNIFORM_FLOATS)
  const params = {
    pointSize: 3,
    autoRotate: true,
    spinSpeed: 0.12,
    activePoints: DEFAULT_POINTS,
  }

  let depthTexture: GPUTexture | null = null
  let depthW = 0
  let depthH = 0
  const ensureDepth = (w: number, h: number) => {
    if (depthTexture && depthW === w && depthH === h) return
    depthTexture?.destroy()
    depthTexture = device.createTexture({
      label: 'point-cloud-depth',
      size: [w, h],
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    depthW = w
    depthH = h
  }

  const frame = (dt: number) => {
    const w = Math.max(1, canvas.width)
    const h = Math.max(1, canvas.height)
    ensureDepth(w, h)

    if (params.autoRotate) camera.azimuth += dt * params.spinSpeed

    const vp = camera.viewProjection(w / h)
    uniforms.set(vp, 0)
    uniforms[16] = w
    uniforms[17] = h
    uniforms[18] = params.pointSize
    device.queue.writeBuffer(uniformBuffer, 0, uniforms)

    const count = Math.max(0, Math.min(MAX_POINTS, Math.floor(params.activePoints)))

    const encoder = device.createCommandEncoder({ label: 'point-cloud-frame' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthTexture!.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.setVertexBuffer(0, instanceBuffer)
    if (count > 0) pass.draw(6, count)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  const dispose = () => {
    detachCamera()
    depthTexture?.destroy()
    instanceBuffer.destroy()
    uniformBuffer.destroy()
  }

  const instance: PointCloudInstance = {
    frame,
    dispose,
    maxPoints: MAX_POINTS,
    params,
  }
  return instance
}

// React-free: the registry attaches the Controls.
export const pointCloudDemo: Demo = {
  id: 'point-cloud',
  title: '3D Point Cloud',
  description:
    'Instanced rendering of a procedural spiral galaxy (up to 1M points). Drag to orbit, scroll to zoom. Depth-tested with an MVP camera (gl-matrix).',
  init,
}
