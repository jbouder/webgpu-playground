import { mat4, vec3 } from 'gl-matrix'
import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import { SpatialHash } from '../../lib/spatial-hash'
import spatialHashSource from '../../lib/spatial-hash.wgsl?raw'
import integrateSource from './integrate.wgsl?raw'
import distanceSource from './solve-distance.wgsl?raw'
import collisionSource from './solve-collision.wgsl?raw'
import finalizeSource from './finalize.wgsl?raw'
import normalsSource from './normals.wgsl?raw'
import renderSource from './render.wgsl?raw'

export interface XpbdInstance extends DemoInstance {
  params: { paused: boolean; substeps: number; iterations: number; gravity: number; wind: number; damping: number; stiffness: number; bendStiffness: number; selfCollision: boolean; particleRadius: number; grabMode: boolean }
  reset(): void
  step(): void
  setResolution(n: number): void
}

// Params: gravity, wind, h, radius, count, resolution, two u32 pads = 32 bytes.
const PARAM_BYTES = 32
// Render: mat4 view-projection (16 floats), light.xyz + padding = 80 bytes.
const RENDER_BYTES = 80
const WG = 64

type Resources = { positions: GPUBuffer; previous: GPUBuffer; velocities: GPUBuffer; normals: GPUBuffer; deltas: GPUBuffer; constraints: GPUBuffer[]; indices: GPUBuffer; hash: SpatialHash; distanceGroups: GPUBindGroup[]; collisionGroup: GPUBindGroup; collisionApplyGroup: GPUBindGroup; integrateGroup: GPUBindGroup; finalizeGroup: GPUBindGroup; normalsGroup: GPUBindGroup; renderGroup: GPUBindGroup; count: number; resolution: number }

function makeCloth(n: number, stiffness: number) {
  const positions = new Float32Array(n * n * 4)
  // Four parity colors per direction keep every distance batch independent.
  const links: Array<Array<[number, number, number, number]>> = [[], [], [], [], [], [], [], []]
  const spacing = 4 / (n - 1)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x; const o = i * 4
    positions.set([(x / (n - 1) - .5) * 4, 3.2, (y / (n - 1) - .5) * 4, y === 0 && (x === 0 || x === n - 1) ? 0 : 1], o)
    if (x > 0) links[(y & 1) * 2 + (x & 1)].push([i - 1, i, spacing, (1 - stiffness) * .0002])
    if (y > 0) links[4 + (x & 1) * 2 + (y & 1)].push([i - n, i, spacing, (1 - stiffness) * .0002])
  }
  return { positions, links }
}

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx
  const params: XpbdInstance['params'] = { paused: false, substeps: 10, iterations: 1, gravity: 9.8, wind: .5, damping: .02, stiffness: .95, bendStiffness: .3, selfCollision: true, particleRadius: .035, grabMode: false }
  const paramBuffer = device.createBuffer({ label: 'xpbd-params', size: PARAM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const dampingBuffer = device.createBuffer({ label: 'xpbd-damping', size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const renderBuffer = device.createBuffer({ label: 'xpbd-render-params', size: RENDER_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
  const module = (label: string, code: string) => device.createShaderModule({ label, code })
  const integrate = device.createComputePipeline({ label: 'xpbd-integrate-pipeline', layout: 'auto', compute: { module: module('xpbd-integrate-shader', integrateSource), entryPoint: 'main' } })
  const distance = device.createComputePipeline({ label: 'xpbd-distance-pipeline', layout: 'auto', compute: { module: module('xpbd-distance-shader', distanceSource), entryPoint: 'main' } })
  const collision = device.createComputePipeline({ label: 'xpbd-collision-pipeline', layout: 'auto', compute: { module: module('xpbd-collision-shader', spatialHashSource + collisionSource), entryPoint: 'accumulate' } })
  const collisionApply = device.createComputePipeline({ label: 'xpbd-collision-apply-pipeline', layout: 'auto', compute: { module: module('xpbd-collision-apply-shader', spatialHashSource + collisionSource), entryPoint: 'apply' } })
  const finalize = device.createComputePipeline({ label: 'xpbd-finalize-pipeline', layout: 'auto', compute: { module: module('xpbd-finalize-shader', finalizeSource), entryPoint: 'main' } })
  const normals = device.createComputePipeline({ label: 'xpbd-normals-pipeline', layout: 'auto', compute: { module: module('xpbd-normals-shader', normalsSource), entryPoint: 'main' } })
  const render = device.createRenderPipeline({ label: 'xpbd-render-pipeline', layout: 'auto', vertex: { module: module('xpbd-render-shader', renderSource), entryPoint: 'vs' }, fragment: { module: module('xpbd-render-shader-fragment', renderSource), entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' } })
  let resources: Resources | null = null
  let indexCount = 0
  const makeBuffer = (label: string, size: number, usage: GPUBufferUsageFlags) => device.createBuffer({ label: `xpbd-${label}`, size, usage })
  const destroyResources = () => { if (!resources) return; for (const b of [resources.positions, resources.previous, resources.velocities, resources.normals, resources.deltas, resources.indices, ...resources.constraints]) b.destroy(); resources.hash.dispose(); resources = null }
  const rebuild = (n: number) => {
    destroyResources()
    const cloth = makeCloth(n, params.stiffness); const count = n * n; const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    const positions = makeBuffer('positions', cloth.positions.byteLength, storage)
    const previous = makeBuffer('previous-positions', cloth.positions.byteLength, storage)
    const velocities = makeBuffer('velocities', cloth.positions.byteLength, storage)
    const normal = makeBuffer('normals', cloth.positions.byteLength, storage)
    const deltas = makeBuffer('collision-deltas', count * 3 * 4, storage)
    device.queue.writeBuffer(positions, 0, cloth.positions); device.queue.writeBuffer(previous, 0, cloth.positions)
    const constraints = cloth.links.map((batch, i) => { const a = new ArrayBuffer(Math.max(16, batch.length * 16)); const u = new Uint32Array(a); const f = new Float32Array(a); batch.forEach((c, k) => { u[k * 4] = c[0]; u[k * 4 + 1] = c[1]; f[k * 4 + 2] = c[2]; f[k * 4 + 3] = c[3] }); const b = makeBuffer(`constraints-${i}`, a.byteLength, storage); device.queue.writeBuffer(b, 0, a); return b })
    const hash = new SpatialHash(device, count, params.particleRadius * 2)
    const integrateGroup = device.createBindGroup({ label: 'xpbd-integrate-group', layout: integrate.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: paramBuffer } }, { binding: 1, resource: { buffer: positions } }, { binding: 2, resource: { buffer: previous } }, { binding: 3, resource: { buffer: velocities } }] })
    const distanceGroups = constraints.map((b, i) => device.createBindGroup({ label: `xpbd-distance-group-${i}`, layout: distance.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: paramBuffer } }, { binding: 1, resource: { buffer: positions } }, { binding: 2, resource: { buffer: b } }] }))
    const collisionEntries = [{ binding: 0, resource: { buffer: paramBuffer } }, { binding: 1, resource: { buffer: positions } }, { binding: 2, resource: { buffer: hash.cellStarts } }, { binding: 3, resource: { buffer: hash.sortedIndices } }, { binding: 4, resource: { buffer: deltas } }, { binding: 5, resource: { buffer: hash.gridUniform } }]
    const collisionGroup = device.createBindGroup({ label: 'xpbd-collision-group', layout: collision.getBindGroupLayout(0), entries: collisionEntries })
    const collisionApplyGroup = device.createBindGroup({ label: 'xpbd-collision-apply-group', layout: collisionApply.getBindGroupLayout(0), entries: collisionEntries })
    const finalizeGroup = device.createBindGroup({ label: 'xpbd-finalize-group', layout: finalize.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: paramBuffer } }, { binding: 1, resource: { buffer: positions } }, { binding: 2, resource: { buffer: previous } }, { binding: 3, resource: { buffer: velocities } }, { binding: 4, resource: { buffer: dampingBuffer } }] })
    const normalsGroup = device.createBindGroup({ label: 'xpbd-normals-group', layout: normals.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: paramBuffer } }, { binding: 1, resource: { buffer: positions } }, { binding: 2, resource: { buffer: normal } }] })
    const renderGroup = device.createBindGroup({ label: 'xpbd-render-group', layout: render.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: renderBuffer } }, { binding: 1, resource: { buffer: positions } }, { binding: 2, resource: { buffer: normal } }] })
    const index = new Uint32Array((n - 1) * (n - 1) * 6); let q = 0; for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const a = y * n + x; index.set([a, a + n, a + 1, a + 1, a + n, a + n + 1], q); q += 6 }
    const indices = makeBuffer('indices', index.byteLength, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST); device.queue.writeBuffer(indices, 0, index); indexCount = index.length
    resources = { positions, previous, velocities, normals: normal, deltas, constraints, indices, hash, distanceGroups, collisionGroup, collisionApplyGroup, integrateGroup, finalizeGroup, normalsGroup, renderGroup, count, resolution: n }
  }
  rebuild(48)
  let azimuth = .6; let elevation = .45; let dragging = false; let lastX = 0; let lastY = 0
  const pointer = (e: PointerEvent) => { const rect = canvas.getBoundingClientRect(); const x = (e.clientX - rect.left) * canvas.width / Math.max(rect.width, 1); const y = (e.clientY - rect.top) * canvas.height / Math.max(rect.height, 1); if (dragging) { azimuth += (x - lastX) * .008; elevation = Math.max(-1.2, Math.min(1.2, elevation + (y - lastY) * .008)) } lastX = x; lastY = y }
  const down = (e: PointerEvent) => { dragging = true; canvas.setPointerCapture(e.pointerId); pointer(e) }; const up = () => { dragging = false }
  canvas.addEventListener('pointermove', pointer); canvas.addEventListener('pointerdown', down); canvas.addEventListener('pointerup', up)
  let stepRequested = false; let disposed = false
  const run = (dt: number, elapsed: number) => {
    if (disposed || !resources || (params.paused && !stepRequested)) return
    stepRequested = false; const r = resources; const h = Math.min(dt, 1 / 60) / Math.max(4, Math.min(20, Math.floor(params.substeps)))
    const u = new ArrayBuffer(PARAM_BYTES); const f = new Float32Array(u); const ints = new Uint32Array(u); f.set([params.gravity, params.wind * Math.sin(elapsed), h, params.particleRadius]); ints[4] = r.count; ints[5] = r.resolution; device.queue.writeBuffer(paramBuffer, 0, u); device.queue.writeBuffer(dampingBuffer, 0, new Float32Array([params.damping]))
    const vp = mat4.create(); const eye = vec3.fromValues(7 * Math.cos(elevation) * Math.sin(azimuth), 3 + 7 * Math.sin(elevation), 7 * Math.cos(elevation) * Math.cos(azimuth)); mat4.perspective(vp, Math.PI / 4, Math.max(canvas.width, 1) / Math.max(canvas.height, 1), .1, 50); mat4.lookAt(vp, eye, vec3.fromValues(0, 1.4, 0), vec3.fromValues(0, 1, 0)); const ru = new Float32Array(20); ru.set(vp); ru.set([4, 7, 4, 0], 16); device.queue.writeBuffer(renderBuffer, 0, ru)
    const encoder = device.createCommandEncoder({ label: 'xpbd-frame' })
    for (let s = 0; s < Math.max(4, Math.min(20, Math.floor(params.substeps))); s++) {
      let pass = encoder.beginComputePass({ label: 'xpbd-integrate-pass' })
      pass.setPipeline(integrate); pass.setBindGroup(0, r.integrateGroup); pass.dispatchWorkgroups(Math.ceil(r.count / WG)); pass.end()
      r.hash.build(encoder, r.positions)
      for (let it = 0; it < params.iterations; it++) {
        for (let i = 0; i < r.distanceGroups.length; i++) {
          pass = encoder.beginComputePass({ label: `xpbd-distance-pass-${i}` })
          pass.setPipeline(distance); pass.setBindGroup(0, r.distanceGroups[i])
          pass.dispatchWorkgroups(Math.ceil((r.constraints[i].size / 16) / WG)); pass.end()
        }
        if (params.selfCollision) {
          pass = encoder.beginComputePass({ label: 'xpbd-collision-pass' })
          pass.setPipeline(collision); pass.setBindGroup(0, r.collisionGroup); pass.dispatchWorkgroups(Math.ceil(r.count / WG)); pass.end()
        }
        // Floor and sphere collision remain active when self collision is disabled.
        pass = encoder.beginComputePass({ label: 'xpbd-collision-apply-pass' })
        pass.setPipeline(collisionApply); pass.setBindGroup(0, r.collisionApplyGroup); pass.dispatchWorkgroups(Math.ceil(r.count / WG)); pass.end()
      }
      pass = encoder.beginComputePass({ label: 'xpbd-finalize-pass' })
      pass.setPipeline(finalize); pass.setBindGroup(0, r.finalizeGroup); pass.dispatchWorkgroups(Math.ceil(r.count / WG)); pass.end()
    }
    let pass = encoder.beginComputePass({ label: 'xpbd-normals-pass' }); pass.setPipeline(normals); pass.setBindGroup(0, r.normalsGroup); pass.dispatchWorkgroups(Math.ceil(r.count / WG)); pass.end()
    const rp = encoder.beginRenderPass({ label: 'xpbd-render-pass', colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: .015, g: .025, b: .05, a: 1 }, loadOp: 'clear', storeOp: 'store' }] }); rp.setPipeline(render); rp.setBindGroup(0, r.renderGroup); rp.setIndexBuffer(r.indices, 'uint32'); rp.drawIndexed(indexCount); rp.end(); device.queue.submit([encoder.finish()])
  }
  const instance: XpbdInstance = { frame: run, dispose: () => { if (disposed) return; disposed = true; canvas.removeEventListener('pointermove', pointer); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointerup', up); destroyResources(); paramBuffer.destroy(); dampingBuffer.destroy(); renderBuffer.destroy() }, params, reset: () => rebuild(resources?.resolution ?? 48), step: () => { stepRequested = true }, setResolution: (n) => rebuild(n) }
  return instance
}

export const xpbdDemo: Demo = { id: 'xpbd', title: 'XPBD Physics', description: 'A GPU particle-constraint physics engine (Extended Position-Based Dynamics). Substepped solve with graph-colored distance constraints and spatial-hash self-collision, shown as cloth. Drag to orbit.', init }
