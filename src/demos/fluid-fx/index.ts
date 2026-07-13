import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import commonSource from './common.wgsl?raw'
import ambientSource from './ambient.wgsl?raw'
import fluidSource from './fluid.wgsl?raw'
import fluidRenderSource from './fluid-render.wgsl?raw'
import particlesUpdateSource from './particles-update.wgsl?raw'
import particlesDrawSource from './particles-draw.wgsl?raw'
import postfxSource from './postfx.wgsl?raw'

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
  Ice: { a: [0.5, 0.55, 0.65], b: [0.4, 0.35, 0.4], c: [1, 1, 1], d: [0.6, 0.75, 0.9] },
}

export type FluidFxMode = 'fluid' | 'flow' | 'ambient'

export interface FluidFxParams {
  mode: FluidFxMode
  palette: Palette
  hue: number
  /** Fluid: auto-inject swirling dye while idle. */
  autoSwirl: boolean
  /** Flow: trail persistence, 0 (short) … 1 (long). */
  trailLength: number
  /** Flow: flow-field advection speed. */
  flowSpeed: number
  /** Ambient: animation speed. */
  ambientSpeed: number
  /** Ambient: domain-warp strength. */
  ambientWarp: number
}

export interface FluidFxInstance extends DemoInstance {
  params: FluidFxParams
  /** Fluid: clear the dye + velocity fields. */
  clearFluid(): void
}

// --- Fluid sim grid (16:9, resize-independent) ---
const SIM_W = 320
const SIM_H = 180
const SIM_WG_X = Math.ceil(SIM_W / 8)
const SIM_WG_Y = Math.ceil(SIM_H / 8)
const PRESSURE_ITERS = 24
const FIELD_FORMAT: GPUTextureFormat = 'rgba16float'
const INJECT_FORCE = 34 // uv-delta → grid velocity
const MAX_INJECT_VEL = 900

// --- Flow particles ---
const PARTICLE_COUNT = 90_000
const PARTICLE_WG = Math.ceil(PARTICLE_COUNT / 64)

// Evaluate the cosine palette on the CPU (mirrors common.wgsl `palette`).
function paletteColor(p: Palette, t: number): [number, number, number] {
  const out = [0, 0, 0] as [number, number, number]
  for (let i = 0; i < 3; i++) {
    out[i] = p.a[i] + p.b[i] * Math.cos(2 * Math.PI * (p.c[i] * t + p.d[i]))
  }
  return out
}

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx

  const withCommon = (src: string) => `${commonSource}\n${src}`
  const ambientModule = device.createShaderModule({
    label: 'ffx-ambient',
    code: withCommon(ambientSource),
  })
  const fluidModule = device.createShaderModule({ label: 'ffx-fluid', code: withCommon(fluidSource) })
  const fluidRenderModule = device.createShaderModule({
    label: 'ffx-fluid-render',
    code: withCommon(fluidRenderSource),
  })
  const pUpdateModule = device.createShaderModule({
    label: 'ffx-particles-update',
    code: withCommon(particlesUpdateSource),
  })
  const pDrawModule = device.createShaderModule({
    label: 'ffx-particles-draw',
    code: withCommon(particlesDrawSource),
  })
  const postfxModule = device.createShaderModule({ label: 'ffx-postfx', code: withCommon(postfxSource) })

  const linearSampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })

  // ============================================================ shared params
  const params: FluidFxParams = {
    mode: 'fluid',
    palette: PALETTES.Rainbow,
    hue: 0,
    autoSwirl: true,
    trailLength: 0.6,
    flowSpeed: 0.2,
    ambientSpeed: 1,
    ambientWarp: 0.9,
  }

  // ============================================================ pointer state
  // All in uv space: [0,1], y-down.
  let px = 0.5
  let py = 0.5
  let lastPx = 0.5
  let lastPy = 0.5
  let userPressed = false
  const setPointer = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    px = (e.clientX - rect.left) / Math.max(rect.width, 1)
    py = (e.clientY - rect.top) / Math.max(rect.height, 1)
  }
  const onDown = (e: PointerEvent) => {
    setPointer(e)
    lastPx = px
    lastPy = py
    userPressed = true
  }
  const onMove = (e: PointerEvent) => setPointer(e)
  const onUp = () => {
    userPressed = false
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)

  // ============================================================ AMBIENT mode
  const ambientU = new Float32Array(24)
  const ambientBuf = device.createBuffer({
    size: ambientU.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const ambientPipeline = device.createRenderPipeline({
    label: 'ffx-ambient',
    layout: 'auto',
    vertex: { module: ambientModule, entryPoint: 'fullscreen_vs' },
    fragment: { module: ambientModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })
  const ambientBind = device.createBindGroup({
    layout: ambientPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: ambientBuf } }],
  })

  // ============================================================ FLUID mode
  const makeField = (label: string) =>
    device.createTexture({
      label,
      size: [SIM_W, SIM_H],
      format: FIELD_FORMAT,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_DST,
    })
  const vel = [makeField('ffx-vel0'), makeField('ffx-vel1')]
  const dye = [makeField('ffx-dye0'), makeField('ffx-dye1')]
  const pres = [makeField('ffx-pres0'), makeField('ffx-pres1')]
  const divg = makeField('ffx-divergence')
  const velV = vel.map((t) => t.createView())
  const dyeV = dye.map((t) => t.createView())
  const presV = pres.map((t) => t.createView())
  const divgV = divg.createView()

  const fluidU = new Float32Array(20)
  const fluidBuf = device.createBuffer({
    size: fluidU.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const fluidRenderU = new Float32Array(4)
  const fluidRenderBuf = device.createBuffer({
    size: fluidRenderU.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const compute = (entryPoint: string) =>
    device.createComputePipeline({
      label: `ffx-${entryPoint}`,
      layout: 'auto',
      compute: { module: fluidModule, entryPoint },
    })
  const splatPipe = compute('splat')
  const advectVelPipe = compute('advectVel')
  const divergencePipe = compute('divergence')
  const pressurePipe = compute('pressure')
  const gradSubPipe = compute('gradSub')
  const advectDyePipe = compute('advectDye')

  const fluidRenderPipe = device.createRenderPipeline({
    label: 'ffx-fluid-render',
    layout: 'auto',
    vertex: { module: fluidRenderModule, entryPoint: 'fullscreen_vs' },
    fragment: { module: fluidRenderModule, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })

  // Ping-pong indices.
  let velCur = 0
  let dyeCur = 0
  let presCur = 0
  const bg = (pipe: GPUComputePipeline, entries: GPUBindGroupEntry[]) =>
    device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries })
  const uni = { binding: 0, resource: { buffer: fluidBuf } }

  // Zero all fields. rgba16float is 8 bytes/texel; an all-zero byte buffer maps
  // to +0.0 half-floats, so a raw zeroed Uint8Array is a valid clear source.
  const clearFluid = () => {
    const zero = new Uint8Array(SIM_W * SIM_H * 8)
    for (const t of [...vel, ...dye, ...pres, divg]) {
      device.queue.writeTexture(
        { texture: t },
        zero,
        { bytesPerRow: SIM_W * 8, rowsPerImage: SIM_H },
        { width: SIM_W, height: SIM_H },
      )
    }
    velCur = 0
    dyeCur = 0
    presCur = 0
  }

  // ============================================================ FLOW mode
  const particleData = new Float32Array(PARTICLE_COUNT * 4)
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particleData[i * 4 + 0] = Math.random()
    particleData[i * 4 + 1] = Math.random()
    particleData[i * 4 + 2] = 0
    particleData[i * 4 + 3] = 0
  }
  const particleBuf = device.createBuffer({
    label: 'ffx-particles',
    size: particleData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(particleBuf, 0, particleData)

  const pUpdateU = new Float32Array(12)
  const pUpdateBuf = device.createBuffer({
    size: pUpdateU.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const pDrawU = new Float32Array(20)
  const pDrawBuf = device.createBuffer({
    size: pDrawU.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const fadeU = new Float32Array(4)
  const fadeBuf = device.createBuffer({
    size: fadeU.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const pUpdatePipe = device.createComputePipeline({
    label: 'ffx-particles-update',
    layout: 'auto',
    compute: { module: pUpdateModule, entryPoint: 'main' },
  })
  const pUpdateBind = device.createBindGroup({
    layout: pUpdatePipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: pUpdateBuf } },
      { binding: 1, resource: { buffer: particleBuf } },
    ],
  })

  const pDrawPipe = device.createRenderPipeline({
    label: 'ffx-particles-draw',
    layout: 'auto',
    vertex: { module: pDrawModule, entryPoint: 'vs' },
    fragment: {
      module: pDrawModule,
      entryPoint: 'fs',
      targets: [
        {
          format: FIELD_FORMAT,
          blend: {
            color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
            alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  })
  const pDrawBind = device.createBindGroup({
    layout: pDrawPipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: pDrawBuf } },
      { binding: 1, resource: { buffer: particleBuf } },
    ],
  })

  const fadePipe = device.createRenderPipeline({
    label: 'ffx-fade',
    layout: 'auto',
    vertex: { module: postfxModule, entryPoint: 'fullscreen_vs' },
    fragment: {
      module: postfxModule,
      entryPoint: 'fade_fs',
      targets: [
        {
          format: FIELD_FORMAT,
          blend: {
            color: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        },
      ],
    },
    primitive: { topology: 'triangle-list' },
  })
  const fadeBind = device.createBindGroup({
    layout: fadePipe.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: fadeBuf } }],
  })

  const blitPipe = device.createRenderPipeline({
    label: 'ffx-blit',
    layout: 'auto',
    vertex: { module: postfxModule, entryPoint: 'fullscreen_vs' },
    fragment: { module: postfxModule, entryPoint: 'blit_fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })

  // Trail accumulation texture — canvas-sized, recreated on resize.
  let trailTex: GPUTexture | null = null
  let trailView: GPUTextureView | null = null
  let blitBind: GPUBindGroup | null = null
  let trailInitialized = false
  let trailW = 0
  let trailH = 0
  const ensureTrail = (w: number, h: number) => {
    if (trailTex && trailW === w && trailH === h) return
    trailTex?.destroy()
    trailW = w
    trailH = h
    trailTex = device.createTexture({
      label: 'ffx-trail',
      size: [w, h],
      format: FIELD_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    trailView = trailTex.createView()
    blitBind = device.createBindGroup({
      layout: blitPipe.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: fadeBuf } },
        { binding: 1, resource: linearSampler },
        { binding: 2, resource: trailView },
      ],
    })
    trailInitialized = false
  }
  ensureTrail(canvas.width, canvas.height)

  // ============================================================ frame
  const frame = (dt: number, elapsed: number) => {
    const step = Math.min(dt, 1 / 30)
    const p = params.palette
    const encoder = device.createCommandEncoder({ label: 'ffx-frame' })
    const view = context.getCurrentTexture().createView()

    if (params.mode === 'ambient') {
      ambientU[0] = canvas.width
      ambientU[1] = canvas.height
      ambientU[2] = elapsed
      ambientU[3] = params.hue
      ambientU[4] = px
      ambientU[5] = py
      ambientU[6] = params.ambientSpeed
      ambientU[7] = params.ambientWarp
      ambientU.set([...p.a, 0], 8)
      ambientU.set([...p.b, 0], 12)
      ambientU.set([...p.c, 0], 16)
      ambientU.set([...p.d, 0], 20)
      device.queue.writeBuffer(ambientBuf, 0, ambientU)

      const rp = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      })
      rp.setPipeline(ambientPipeline)
      rp.setBindGroup(0, ambientBind)
      rp.draw(3)
      rp.end()
    } else if (params.mode === 'fluid') {
      // Pointer motion this frame (uv/frame) → injected grid velocity.
      let ptrX = px
      let ptrY = py
      let dvx = px - lastPx
      let dvy = py - lastPy
      let pressed = userPressed ? 1 : 0
      let color: [number, number, number]

      if (!userPressed && params.autoSwirl) {
        // Drive an autonomous lissajous stroke.
        const t = elapsed
        const ax = 0.5 + 0.32 * Math.cos(t * 0.7)
        const ay = 0.5 + 0.28 * Math.sin(t * 1.1)
        dvx = ax - ptrX
        dvy = ay - ptrY
        // Seed from the auto position so the field keeps its motion continuous.
        ptrX = ax
        ptrY = ay
        pressed = 1
        color = paletteColor(p, t * 0.08 + params.hue)
      } else {
        color = paletteColor(p, elapsed * 0.15 + params.hue)
      }
      lastPx = px
      lastPy = py

      let fx = dvx * SIM_W * INJECT_FORCE
      let fy = dvy * SIM_H * INJECT_FORCE
      const mag = Math.hypot(fx, fy)
      if (mag > MAX_INJECT_VEL) {
        fx = (fx / mag) * MAX_INJECT_VEL
        fy = (fy / mag) * MAX_INJECT_VEL
      }

      fluidU[0] = 1 / SIM_W
      fluidU[1] = 1 / SIM_H
      fluidU[2] = step
      fluidU[3] = elapsed
      fluidU[4] = ptrX
      fluidU[5] = ptrY
      fluidU[6] = fx
      fluidU[7] = fy
      fluidU[8] = 0.0025 // splat radius
      fluidU[9] = 0.998 // vel dissipation
      fluidU[10] = 0.994 // dye dissipation
      fluidU[11] = pressed
      fluidU[12] = color[0] * 0.6
      fluidU[13] = color[1] * 0.6
      fluidU[14] = color[2] * 0.6
      fluidU[15] = 1
      fluidU[16] = SIM_W
      fluidU[17] = SIM_H
      device.queue.writeBuffer(fluidBuf, 0, fluidU)

      const cp = encoder.beginComputePass()

      // 1) Splat velocity + dye.
      cp.setPipeline(splatPipe)
      cp.setBindGroup(
        0,
        bg(splatPipe, [
          uni,
          { binding: 1, resource: velV[velCur] },
          { binding: 2, resource: dyeV[dyeCur] },
          { binding: 3, resource: velV[1 - velCur] },
          { binding: 4, resource: dyeV[1 - dyeCur] },
        ]),
      )
      cp.dispatchWorkgroups(SIM_WG_X, SIM_WG_Y)
      velCur = 1 - velCur
      dyeCur = 1 - dyeCur

      // 2) Advect velocity.
      cp.setPipeline(advectVelPipe)
      cp.setBindGroup(
        0,
        bg(advectVelPipe, [
          uni,
          { binding: 5, resource: linearSampler },
          { binding: 6, resource: velV[velCur] },
          { binding: 7, resource: velV[1 - velCur] },
        ]),
      )
      cp.dispatchWorkgroups(SIM_WG_X, SIM_WG_Y)
      velCur = 1 - velCur

      // 3) Divergence.
      cp.setPipeline(divergencePipe)
      cp.setBindGroup(
        0,
        bg(divergencePipe, [
          uni,
          { binding: 8, resource: velV[velCur] },
          { binding: 9, resource: divgV },
        ]),
      )
      cp.dispatchWorkgroups(SIM_WG_X, SIM_WG_Y)

      // 4) Pressure Jacobi iterations (warm-started from last frame).
      cp.setPipeline(pressurePipe)
      for (let i = 0; i < PRESSURE_ITERS; i++) {
        cp.setBindGroup(
          0,
          bg(pressurePipe, [
            uni,
            { binding: 10, resource: presV[presCur] },
            { binding: 11, resource: divgV },
            { binding: 12, resource: presV[1 - presCur] },
          ]),
        )
        cp.dispatchWorkgroups(SIM_WG_X, SIM_WG_Y)
        presCur = 1 - presCur
      }

      // 5) Subtract pressure gradient.
      cp.setPipeline(gradSubPipe)
      cp.setBindGroup(
        0,
        bg(gradSubPipe, [
          uni,
          { binding: 13, resource: velV[velCur] },
          { binding: 14, resource: presV[presCur] },
          { binding: 15, resource: velV[1 - velCur] },
        ]),
      )
      cp.dispatchWorkgroups(SIM_WG_X, SIM_WG_Y)
      velCur = 1 - velCur

      // 6) Advect dye.
      cp.setPipeline(advectDyePipe)
      cp.setBindGroup(
        0,
        bg(advectDyePipe, [
          uni,
          { binding: 16, resource: linearSampler },
          { binding: 17, resource: dyeV[dyeCur] },
          { binding: 18, resource: velV[velCur] },
          { binding: 19, resource: dyeV[1 - dyeCur] },
        ]),
      )
      cp.dispatchWorkgroups(SIM_WG_X, SIM_WG_Y)
      dyeCur = 1 - dyeCur
      cp.end()

      // Present.
      fluidRenderU[0] = 1.3 // exposure
      device.queue.writeBuffer(fluidRenderBuf, 0, fluidRenderU)
      const rp = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      })
      rp.setPipeline(fluidRenderPipe)
      rp.setBindGroup(
        0,
        device.createBindGroup({
          layout: fluidRenderPipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: fluidRenderBuf } },
            { binding: 1, resource: linearSampler },
            { binding: 2, resource: dyeV[dyeCur] },
          ],
        }),
      )
      rp.draw(3)
      rp.end()
    } else {
      // ---- FLOW ----
      ensureTrail(canvas.width, canvas.height)

      pUpdateU[0] = px
      pUpdateU[1] = py
      pUpdateU[2] = elapsed
      pUpdateU[3] = step
      pUpdateU[4] = userPressed ? 1 : 0
      pUpdateU[5] = PARTICLE_COUNT
      pUpdateU[6] = params.flowSpeed
      pUpdateU[7] = 3.0 // curl scale
      pUpdateU[8] = canvas.width / Math.max(canvas.height, 1)
      device.queue.writeBuffer(pUpdateBuf, 0, pUpdateU)

      const cp = encoder.beginComputePass()
      cp.setPipeline(pUpdatePipe)
      cp.setBindGroup(0, pUpdateBind)
      cp.dispatchWorkgroups(PARTICLE_WG)
      cp.end()

      // Trail: fade the accumulation, then draw particles additively.
      pDrawU[0] = canvas.width
      pDrawU[1] = canvas.height
      pDrawU[2] = params.hue
      pDrawU[3] = Math.max(1.5, Math.min(canvas.width, canvas.height) / 480) * 2.2
      pDrawU.set([...p.a, 0], 4)
      pDrawU.set([...p.b, 0], 8)
      pDrawU.set([...p.c, 0], 12)
      pDrawU.set([...p.d, 0], 16)
      device.queue.writeBuffer(pDrawBuf, 0, pDrawU)

      // fade amount: longer trail → smaller per-frame darken.
      fadeU[0] = 0.005 + (1 - params.trailLength) * 0.2
      fadeU[1] = 1.25 // exposure for blit
      device.queue.writeBuffer(fadeBuf, 0, fadeU)

      const trailPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: trailView as GPUTextureView,
            loadOp: trailInitialized ? 'load' : 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      })
      trailInitialized = true
      if (fadeU[0] > 0) {
        trailPass.setPipeline(fadePipe)
        trailPass.setBindGroup(0, fadeBind)
        trailPass.draw(3)
      }
      trailPass.setPipeline(pDrawPipe)
      trailPass.setBindGroup(0, pDrawBind)
      trailPass.draw(6, PARTICLE_COUNT)
      trailPass.end()

      const rp = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      })
      rp.setPipeline(blitPipe)
      rp.setBindGroup(0, blitBind as GPUBindGroup)
      rp.draw(3)
      rp.end()
    }

    device.queue.submit([encoder.finish()])
  }

  const resize = (w: number, h: number) => {
    ensureTrail(w, h)
  }

  const dispose = () => {
    canvas.removeEventListener('pointerdown', onDown)
    canvas.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    for (const t of [...vel, ...dye, ...pres, divg]) t.destroy()
    trailTex?.destroy()
    particleBuf.destroy()
    ;[
      ambientBuf,
      fluidBuf,
      fluidRenderBuf,
      pUpdateBuf,
      pDrawBuf,
      fadeBuf,
    ].forEach((b) => b.destroy())
  }

  const instance: FluidFxInstance = {
    frame,
    resize,
    dispose,
    params,
    clearFluid,
  }
  return instance
}

// React-free: the registry attaches the Controls.
export const fluidFxDemo: Demo = {
  id: 'fluid-fx',
  title: 'Fluid FX',
  description:
    'A GPU effects playground with three toggleable modes sharing one color palette: an interactive Navier–Stokes fluid (drag to inject swirling dye), a curl-noise particle flow field with trails, and a passive domain-warped ambient color field.',
  init,
}
