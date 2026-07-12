import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import seedSource from '../fluid-scroll/seed.wgsl?raw'
import stepSource from '../fluid-scroll/step.wgsl?raw'
import bgSource from './background.wgsl?raw'
import overlaySource from './overlay.wgsl?raw'

/** Inigo Quilez cosine-palette coefficients: a + b·cos(2π(c·t + d)). */
export interface Palette {
  a: [number, number, number]
  b: [number, number, number]
  c: [number, number, number]
  d: [number, number, number]
}

export const PALETTES: Record<string, Palette> = {
  Rainbow: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0, 0.33, 0.67] },
  Ember: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 0.5], d: [0.8, 0.9, 0.3] },
  Aurora: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0.3, 0.2, 0.2] },
  Neon: { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [2, 1, 0], d: [0.5, 0.2, 0.25] },
  Slate: { a: [0.4, 0.45, 0.55], b: [0.25, 0.25, 0.3], c: [1, 1, 1], d: [0.6, 0.6, 0.6] },
}

export interface ShaderFluidInstance extends DemoInstance {
  params: {
    showShader: boolean
    showFluid: boolean
    autoScroll: boolean
    hue: number
    palette: Palette
  }
  reseed(): void
  getScroll(): number
}

// Reaction-diffusion sim grid (16:9, multiples of 8) — resize-independent.
const SIM_W = 640
const SIM_H = 360
const WG_X = Math.ceil(SIM_W / 8)
const WG_Y = Math.ceil(SIM_H / 8)
const STEPS_PER_FRAME = 10
const FIELD_FORMAT: GPUTextureFormat = 'rgba16float'

const SIM_FLOATS = 12
const SEED_FLOATS = 4
const BG_FLOATS = 24 // resolution, time, hue, mouse, pad, palA..D
const OVERLAY_FLOATS = 8 // resolution, time, scroll, warp, +3 pad

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx

  const seedModule = device.createShaderModule({ label: 'sf-seed', code: seedSource })
  const stepModule = device.createShaderModule({ label: 'sf-step', code: stepSource })
  const bgModule = device.createShaderModule({ label: 'sf-bg', code: bgSource })
  const overlayModule = device.createShaderModule({ label: 'sf-overlay', code: overlaySource })

  // --- Reaction-diffusion field (ping-pong) ---
  const makeField = (i: number) =>
    device.createTexture({
      label: `sf-field-${i}`,
      size: [SIM_W, SIM_H],
      format: FIELD_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })
  const fields = [makeField(0), makeField(1)]
  const views = fields.map((t) => t.createView())

  const seedBuffer = device.createBuffer({
    size: SEED_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const simBuffer = device.createBuffer({
    size: SIM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const bgBuffer = device.createBuffer({
    size: BG_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const overlayBuffer = device.createBuffer({
    size: OVERLAY_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const seedPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: seedModule, entryPoint: 'main' },
  })
  const simPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: stepModule, entryPoint: 'main' },
  })
  const bgPipeline = device.createRenderPipeline({
    label: 'sf-bg-pipeline',
    layout: 'auto',
    vertex: { module: bgModule, entryPoint: 'vs' },
    fragment: { module: bgModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const overlayPipeline = device.createRenderPipeline({
    label: 'sf-overlay-pipeline',
    layout: 'auto',
    vertex: { module: overlayModule, entryPoint: 'vs' },
    fragment: {
      module: overlayModule,
      entryPoint: 'fs',
      targets: [
        {
          format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  })

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  const seedBindGroup = device.createBindGroup({
    layout: seedPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: seedBuffer } },
      { binding: 1, resource: views[0] },
    ],
  })
  const simBindGroups = [0, 1].map((i) =>
    device.createBindGroup({
      layout: simPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: simBuffer } },
        { binding: 1, resource: views[i] },
        { binding: 2, resource: views[1 - i] },
      ],
    }),
  )
  const overlayBindGroups = [0, 1].map((i) =>
    device.createBindGroup({
      layout: overlayPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: overlayBuffer } },
        { binding: 1, resource: views[i] },
        { binding: 2, resource: sampler },
      ],
    }),
  )
  const bgBindGroup = device.createBindGroup({
    layout: bgPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: bgBuffer } }],
  })

  const seedU = new Float32Array(SEED_FLOATS)
  const simU = new Float32Array(SIM_FLOATS)
  const bgU = new Float32Array(BG_FLOATS)
  const overlayU = new Float32Array(OVERLAY_FLOATS)

  let cur = 0
  const runSeed = () => {
    seedU[0] = SIM_W
    seedU[1] = SIM_H
    seedU[2] = Math.random() * 1000
    device.queue.writeBuffer(seedBuffer, 0, seedU)
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(seedPipeline)
    pass.setBindGroup(0, seedBindGroup)
    pass.dispatchWorkgroups(WG_X, WG_Y)
    pass.end()
    device.queue.submit([encoder.finish()])
    cur = 0
  }
  runSeed()

  const params: ShaderFluidInstance['params'] = {
    showShader: true,
    showFluid: false,
    autoScroll: true,
    hue: 0,
    palette: PALETTES.Rainbow,
  }

  // Pointer (shader mouse) + wheel (fluid scroll).
  let mouseX = 0
  let mouseY = 0
  const onPointerMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    mouseX = (e.clientX - rect.left) * (canvas.width / Math.max(rect.width, 1))
    mouseY = (e.clientY - rect.top) * (canvas.height / Math.max(rect.height, 1))
  }
  let scrollPos = 0
  let scrollTarget = 0
  let lastScroll = 0
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    scrollTarget += e.deltaY * 0.5
  }
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('wheel', onWheel, { passive: false })

  const frame = (dt: number, elapsed: number) => {
    // --- Advance the fluid sim ---
    if (params.autoScroll) scrollTarget += dt * 40
    scrollPos += (scrollTarget - scrollPos) * Math.min(1, dt * 6)
    const frameVel = scrollPos - lastScroll
    lastScroll = scrollPos
    const velY = Math.max(-0.5, Math.min(0.5, frameVel * 0.02))
    const feed = 0.03 + 0.02 * (0.5 + 0.5 * Math.sin(scrollPos * 0.0015))
    const kill = 0.058 + 0.006 * (0.5 + 0.5 * Math.cos(scrollPos * 0.0011))

    simU[0] = SIM_W
    simU[1] = SIM_H
    simU[2] = feed
    simU[3] = kill
    simU[4] = 1.0
    simU[5] = 0.5
    simU[6] = 1.0
    simU[7] = 0.0
    simU[8] = velY
    device.queue.writeBuffer(simBuffer, 0, simU)

    const encoder = device.createCommandEncoder({ label: 'sf-frame' })

    if (params.showFluid) {
      for (let i = 0; i < STEPS_PER_FRAME; i++) {
        const pass = encoder.beginComputePass()
        pass.setPipeline(simPipeline)
        pass.setBindGroup(0, simBindGroups[cur])
        pass.dispatchWorkgroups(WG_X, WG_Y)
        pass.end()
        cur = 1 - cur
      }
    }

    // --- Composite render ---
    const w = canvas.width
    const h = canvas.height
    const p = params.palette
    bgU[0] = w
    bgU[1] = h
    bgU[2] = elapsed
    bgU[3] = params.hue
    bgU[4] = mouseX
    bgU[5] = mouseY
    bgU.set([p.a[0], p.a[1], p.a[2], 0], 8)
    bgU.set([p.b[0], p.b[1], p.b[2], 0], 12)
    bgU.set([p.c[0], p.c[1], p.c[2], 0], 16)
    bgU.set([p.d[0], p.d[1], p.d[2], 0], 20)
    device.queue.writeBuffer(bgBuffer, 0, bgU)

    overlayU[0] = w
    overlayU[1] = h
    overlayU[2] = elapsed
    overlayU[3] = scrollPos
    overlayU[4] = 1.0 + Math.min(3, Math.abs(frameVel) * 0.05)
    device.queue.writeBuffer(overlayBuffer, 0, overlayU)

    const rpass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.03, b: 0.07, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    if (params.showShader) {
      rpass.setPipeline(bgPipeline)
      rpass.setBindGroup(0, bgBindGroup)
      rpass.draw(3)
    }
    if (params.showFluid) {
      rpass.setPipeline(overlayPipeline)
      rpass.setBindGroup(0, overlayBindGroups[cur])
      rpass.draw(3)
    }
    rpass.end()

    device.queue.submit([encoder.finish()])
  }

  const dispose = () => {
    canvas.removeEventListener('pointermove', onPointerMove)
    canvas.removeEventListener('wheel', onWheel)
    fields.forEach((t) => t.destroy())
    seedBuffer.destroy()
    simBuffer.destroy()
    bgBuffer.destroy()
    overlayBuffer.destroy()
  }

  const instance: ShaderFluidInstance = {
    frame,
    dispose,
    params,
    reseed: runSeed,
    getScroll: () => scrollPos,
  }
  return instance
}

// React-free: the registry attaches the Controls.
export const shaderFluidDemo: Demo = {
  id: 'shader-fluid',
  title: 'Shader + Fluid',
  description:
    'An animated plasma shader with rippling distortion, scanlines, and vignette as a background layer for a Gray-Scott reaction-diffusion fluid. Toggle each layer, recolor the shader, and scroll over the canvas to drive the fluid.',
  init,
}
