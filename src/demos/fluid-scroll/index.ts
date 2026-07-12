import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import seedSource from './seed.wgsl?raw'
import stepSource from './step.wgsl?raw'
import renderSource from './render.wgsl?raw'

/** Extra surface the Controls panel pokes. State lives here, not in React. */
export interface FluidScrollInstance extends DemoInstance {
  params: { autoScroll: boolean }
  reseed(): void
  /** Current virtual scroll position, for display. */
  getScroll(): number
}

// Fixed simulation grid (16:9, multiples of 8). Independent of canvas size, so
// resizing the window never disturbs the field — the render pass just stretches
// it full-bleed.
const SIM_W = 640
const SIM_H = 360
const WG_X = Math.ceil(SIM_W / 8)
const WG_Y = Math.ceil(SIM_H / 8)
const STEPS_PER_FRAME = 10
const FIELD_FORMAT: GPUTextureFormat = 'rgba16float'

const SIM_FLOATS = 12 // dims.xy, feed, kill, dA, dB, dt, velX, velY, +pad → 48B
const SEED_FLOATS = 4 // dims.xy, seed, pad → 16B
const RENDER_FLOATS = 8 // resolution.xy, time, scroll, warp, +3 pad → 32B

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx

  const seedModule = device.createShaderModule({ label: 'fluid-seed', code: seedSource })
  const stepModule = device.createShaderModule({ label: 'fluid-step', code: stepSource })
  const renderModule = device.createShaderModule({ label: 'fluid-render', code: renderSource })

  // Ping-pong field textures.
  const makeField = (i: number) =>
    device.createTexture({
      label: `fluid-field-${i}`,
      size: [SIM_W, SIM_H],
      format: FIELD_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    })
  const fields = [makeField(0), makeField(1)]
  const views = fields.map((t) => t.createView())

  const seedBuffer = device.createBuffer({
    label: 'fluid-seed-uniforms',
    size: SEED_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const simBuffer = device.createBuffer({
    label: 'fluid-sim-uniforms',
    size: SIM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const renderBuffer = device.createBuffer({
    label: 'fluid-render-uniforms',
    size: RENDER_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const seedPipeline = device.createComputePipeline({
    label: 'fluid-seed-pipeline',
    layout: 'auto',
    compute: { module: seedModule, entryPoint: 'main' },
  })
  const simPipeline = device.createComputePipeline({
    label: 'fluid-sim-pipeline',
    layout: 'auto',
    compute: { module: stepModule, entryPoint: 'main' },
  })
  const renderPipeline = device.createRenderPipeline({
    label: 'fluid-render-pipeline',
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'vs' },
    fragment: { module: renderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  // Seed always writes field 0.
  const seedBindGroup = device.createBindGroup({
    layout: seedPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: seedBuffer } },
      { binding: 1, resource: views[0] },
    ],
  })
  // bgSim[i]: read field i, write field 1-i.
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
  // bgRender[i]: sample field i.
  const renderBindGroups = [0, 1].map((i) =>
    device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: renderBuffer } },
        { binding: 1, resource: views[i] },
        { binding: 2, resource: sampler },
      ],
    }),
  )

  const seedU = new Float32Array(SEED_FLOATS)
  const simU = new Float32Array(SIM_FLOATS)
  const renderU = new Float32Array(RENDER_FLOATS)

  // `cur` always holds the index of the latest field.
  let cur = 0

  const runSeed = () => {
    seedU[0] = SIM_W
    seedU[1] = SIM_H
    seedU[2] = Math.random() * 1000
    device.queue.writeBuffer(seedBuffer, 0, seedU)

    const encoder = device.createCommandEncoder({ label: 'fluid-seed' })
    const pass = encoder.beginComputePass()
    pass.setPipeline(seedPipeline)
    pass.setBindGroup(0, seedBindGroup)
    pass.dispatchWorkgroups(WG_X, WG_Y)
    pass.end()
    device.queue.submit([encoder.finish()])
    cur = 0
  }
  runSeed()

  // --- Virtual scroll with inertia (wheel over the canvas) ---
  const params = { autoScroll: true }
  let scrollPos = 0
  let scrollTarget = 0
  let lastScroll = 0
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    scrollTarget += e.deltaY * 0.5
  }
  canvas.addEventListener('wheel', onWheel, { passive: false })

  const frame = (dt: number, elapsed: number) => {
    // Auto-drift so motion is visible even without scrolling.
    if (params.autoScroll) scrollTarget += dt * 40
    scrollPos += (scrollTarget - scrollPos) * Math.min(1, dt * 6)
    const frameVel = scrollPos - lastScroll
    lastScroll = scrollPos
    // Scroll velocity → advection (clamped for stability).
    const velY = Math.max(-0.5, Math.min(0.5, frameVel * 0.02))

    // Scroll position wanders the feed/kill params through pattern regimes.
    const feed = 0.03 + 0.02 * (0.5 + 0.5 * Math.sin(scrollPos * 0.0015))
    const kill = 0.058 + 0.006 * (0.5 + 0.5 * Math.cos(scrollPos * 0.0011))

    simU[0] = SIM_W
    simU[1] = SIM_H
    simU[2] = feed
    simU[3] = kill
    simU[4] = 1.0 // dA
    simU[5] = 0.5 // dB
    simU[6] = 1.0 // dt
    simU[7] = 0.0 // velX
    simU[8] = velY
    device.queue.writeBuffer(simBuffer, 0, simU)

    const encoder = device.createCommandEncoder({ label: 'fluid-frame' })

    // One compute pass per step guarantees read-after-write ordering on the
    // ping-pong textures without relying on intra-pass barrier behavior.
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      const pass = encoder.beginComputePass()
      pass.setPipeline(simPipeline)
      pass.setBindGroup(0, simBindGroups[cur])
      pass.dispatchWorkgroups(WG_X, WG_Y)
      pass.end()
      cur = 1 - cur
    }

    renderU[0] = canvas.width
    renderU[1] = canvas.height
    renderU[2] = elapsed
    renderU[3] = scrollPos
    renderU[4] = 1.0 + Math.min(3, Math.abs(frameVel) * 0.05) // warp
    device.queue.writeBuffer(renderBuffer, 0, renderU)

    const rpass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    rpass.setPipeline(renderPipeline)
    rpass.setBindGroup(0, renderBindGroups[cur])
    rpass.draw(3)
    rpass.end()

    device.queue.submit([encoder.finish()])
  }

  const dispose = () => {
    canvas.removeEventListener('wheel', onWheel)
    fields.forEach((t) => t.destroy())
    seedBuffer.destroy()
    simBuffer.destroy()
    renderBuffer.destroy()
  }

  const instance: FluidScrollInstance = {
    frame,
    dispose,
    params,
    reseed: runSeed,
    getScroll: () => scrollPos,
  }
  return instance
}

// React-free: the registry attaches the Controls component.
export const fluidScrollDemo: Demo = {
  id: 'fluid-scroll',
  title: 'Fluid Scroll',
  description:
    'A Gray-Scott reaction-diffusion field simulated in a compute pass, rendered full-bleed. Scroll over the canvas — scroll speed advects the field and scroll position drives the pattern and color.',
  init,
}
