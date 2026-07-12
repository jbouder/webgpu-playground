import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import { BINS, binCenter, DIMENSIONS } from './data'
import { CrossfilterEngine } from './engine'
import renderSource from './render.wgsl?raw'

export interface PanelInfo {
  label: string
  /** 1D dimension index, or -1 for the 2D scatter. */
  dim: number
  kind: 'bars' | 'heat'
  color: [number, number, number]
}

export interface HoverInfo {
  panel: number
  label: string
  value: string
  count: number
}

export interface CrossfilterInstance extends DemoInstance {
  engine: CrossfilterEngine
  panels: PanelInfo[]
  setRowCount(n: number): Promise<void>
  reset(): void
  hover: HoverInfo | null
  busy: boolean
  onStateChange: (() => void) | null
}

// Panels in normalized canvas coords [x, y, w, h], y down. Three histograms on
// top; a wide time series and the scatter heatmap below.
const PANELS: (PanelInfo & { rect: [number, number, number, number] })[] = [
  { label: 'Latency', dim: 0, kind: 'bars', color: [0.43, 0.66, 1.0], rect: [0.0, 0.0, 0.335, 0.46] },
  { label: 'Cost', dim: 1, kind: 'bars', color: [0.49, 0.86, 0.63], rect: [0.335, 0.0, 0.33, 0.46] },
  { label: 'Tokens', dim: 2, kind: 'bars', color: [0.7, 0.53, 1.0], rect: [0.665, 0.0, 0.335, 0.46] },
  { label: 'Time of day', dim: 3, kind: 'bars', color: [1.0, 0.81, 0.43], rect: [0.0, 0.48, 0.56, 0.52] },
  { label: 'Latency × Cost', dim: -1, kind: 'heat', color: [0.43, 0.66, 1.0], rect: [0.56, 0.48, 0.44, 0.52] },
]

const PANEL_STRIDE = 256 // dynamic-offset alignment
const INSET = 10 // px gap around each panel's viewport

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx
  const engine = new CrossfilterEngine(device)

  // --- Render pipelines (shared explicit layout for dynamic panel uniform) ---
  const module = device.createShaderModule({ label: 'xf-render', code: renderSource })
  const bgl = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      {
        binding: 2,
        visibility: GPUShaderStage.VERTEX,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 64 },
      },
    ],
  })
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bgl] })

  const makePipeline = (vs: string, blend?: GPUBlendState) =>
    device.createRenderPipeline({
      label: `xf-${vs}`,
      layout: pipelineLayout,
      vertex: { module, entryPoint: vs },
      fragment: { module, entryPoint: 'fs_solid', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    })
  const barsPipeline = makePipeline('vs_bars')
  const heatPipeline = makePipeline('vs_heat')
  const brushPipeline = makePipeline('vs_brush', {
    color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  })

  const panelUBuffer = device.createBuffer({
    label: 'xf-panel-uniforms',
    size: PANELS.length * PANEL_STRIDE,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const panelUData = new ArrayBuffer(PANELS.length * PANEL_STRIDE)
  const panelUView = new DataView(panelUData)

  // hist1d / density are stable for the engine's lifetime (only the row buffer
  // is replaced on setData), so this bind group never needs rebuilding.
  const bindGroup = device.createBindGroup({
    layout: bgl,
    entries: [
      { binding: 0, resource: { buffer: engine.hist1d } },
      { binding: 1, resource: { buffer: engine.density } },
      { binding: 2, resource: { buffer: panelUBuffer, offset: 0, size: 64 } },
    ],
  })

  // Pixel rect for a panel's viewport (with inset), from the current canvas size.
  const viewportOf = (rect: [number, number, number, number]) => {
    const x = Math.floor(rect[0] * canvas.width) + INSET
    const y = Math.floor(rect[1] * canvas.height) + INSET
    const w = Math.max(1, Math.floor(rect[2] * canvas.width) - INSET * 2)
    const h = Math.max(1, Math.floor(rect[3] * canvas.height) - INSET * 2)
    return { x, y, w, h }
  }

  const instance: CrossfilterInstance = {
    engine,
    panels: PANELS.map((p) => ({ label: p.label, dim: p.dim, kind: p.kind, color: p.color })),
    hover: null,
    busy: false,
    onStateChange: null,
    async setRowCount(n: number) {
      this.busy = true
      this.onStateChange?.()
      // Yield so the "Generating…" state paints before the blocking gen/upload.
      await new Promise((r) => setTimeout(r, 0))
      await engine.setData(n)
      this.busy = false
      this.onStateChange?.()
    },
    reset() {
      engine.clearAll()
      void engine.readback().then(() => this.onStateChange?.())
      this.onStateChange?.()
    },
    frame() {
      // Pack per-panel uniforms.
      for (let p = 0; p < PANELS.length; p++) {
        const panel = PANELS[p]
        const off = p * PANEL_STRIDE
        const brush = panel.dim >= 0 ? engine.brushes[panel.dim] : null
        panelUView.setUint32(off + 0, BINS, true)
        panelUView.setUint32(off + 4, panel.dim >= 0 ? panel.dim * BINS : 0, true)
        panelUView.setUint32(off + 8, brush ? brush.lo : 0, true)
        panelUView.setUint32(off + 12, brush ? brush.hi : 0, true)
        panelUView.setUint32(off + 16, brush ? 1 : 0, true)
        const maxIdx = panel.dim >= 0 ? panel.dim : DIMENSIONS.length
        panelUView.setFloat32(off + 20, engine.baseMax[maxIdx], true)
        panelUView.setFloat32(off + 32, panel.color[0], true)
        panelUView.setFloat32(off + 36, panel.color[1], true)
        panelUView.setFloat32(off + 40, panel.color[2], true)
        panelUView.setFloat32(off + 44, 1, true)
      }
      device.queue.writeBuffer(panelUBuffer, 0, panelUData)

      const encoder = device.createCommandEncoder({ label: 'xf-render' })
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.04, g: 0.05, b: 0.07, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
      })

      for (let p = 0; p < PANELS.length; p++) {
        const panel = PANELS[p]
        const v = viewportOf(panel.rect)
        pass.setViewport(v.x, v.y, v.w, v.h, 0, 1)
        pass.setBindGroup(0, bindGroup, [p * PANEL_STRIDE])
        if (panel.kind === 'heat') {
          pass.setPipeline(heatPipeline)
          pass.draw(6, BINS * BINS)
        } else {
          pass.setPipeline(barsPipeline)
          pass.draw(6, BINS)
        }
      }

      // Brush overlays on top of the 1D panels.
      pass.setPipeline(brushPipeline)
      for (let p = 0; p < PANELS.length; p++) {
        const panel = PANELS[p]
        if (panel.dim < 0 || !engine.brushes[panel.dim]) continue
        const v = viewportOf(panel.rect)
        pass.setViewport(v.x, v.y, v.w, v.h, 0, 1)
        pass.setBindGroup(0, bindGroup, [p * PANEL_STRIDE])
        pass.draw(6, 1)
      }

      pass.end()
      device.queue.submit([encoder.finish()])
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      engine.dispose()
      panelUBuffer.destroy()
    },
  }

  // --- Pointer brushing ---
  // Locate the panel under a client point; return panel index + bin (or null).
  const locate = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect()
    const nx = (clientX - rect.left) / rect.width
    const ny = (clientY - rect.top) / rect.height
    for (let p = 0; p < PANELS.length; p++) {
      const [rx, ry, rw, rh] = PANELS[p].rect
      if (nx >= rx && nx < rx + rw && ny >= ry && ny < ry + rh) {
        const frac = (nx - rx) / rw
        const bin = Math.max(0, Math.min(BINS - 1, Math.floor(frac * BINS)))
        return { panel: p, bin }
      }
    }
    return null
  }

  let drag: { panel: number; dim: number; startBin: number; moved: boolean } | null = null

  const onDown = (e: PointerEvent) => {
    const hit = locate(e.clientX, e.clientY)
    if (!hit) return
    const panel = PANELS[hit.panel]
    if (panel.dim < 0) return // scatter isn't brushable in this build
    drag = { panel: hit.panel, dim: panel.dim, startBin: hit.bin, moved: false }
    canvas.setPointerCapture(e.pointerId)
    engine.setBrush(panel.dim, { lo: hit.bin, hi: hit.bin })
    instance.onStateChange?.()
  }

  const onMove = (e: PointerEvent) => {
    if (drag) {
      const hit = locate(e.clientX, e.clientY)
      if (!hit) return
      if (hit.bin !== drag.startBin) drag.moved = true
      const lo = Math.min(drag.startBin, hit.bin)
      const hi = Math.max(drag.startBin, hit.bin)
      engine.setBrush(drag.dim, { lo, hi })
      instance.onStateChange?.()
      return
    }
    // Hover readout (throttled to bin changes).
    const hit = locate(e.clientX, e.clientY)
    if (!hit) {
      if (instance.hover) {
        instance.hover = null
        instance.onStateChange?.()
      }
      return
    }
    const panel = PANELS[hit.panel]
    if (panel.dim < 0) return
    const value = DIMENSIONS[panel.dim].format(binCenter(DIMENSIONS[panel.dim], hit.bin))
    const count = engine.countAt(panel.dim, hit.bin)
    if (!instance.hover || instance.hover.panel !== hit.panel || instance.hover.count !== count) {
      instance.hover = { panel: hit.panel, label: panel.label, value, count }
      instance.onStateChange?.()
    }
  }

  const onUp = (e: PointerEvent) => {
    if (!drag) return
    // A click without a drag toggles the brush off.
    if (!drag.moved) engine.setBrush(drag.dim, null)
    canvas.releasePointerCapture?.(e.pointerId)
    drag = null
    void engine.readback().then(() => instance.onStateChange?.())
    instance.onStateChange?.()
  }

  canvas.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)

  // Initial dataset.
  await engine.setData(1_000_000)

  return instance
}

export const crossfilterDemo: Demo = {
  id: 'crossfilter',
  title: 'Crossfilter Dashboard',
  description:
    'Linked brushing over a million rows of synthetic LLM telemetry. Drag a range on any histogram and every other panel refilters instantly — all aggregation runs on the GPU (atomic-scatter histograms), so the CPU never rescans the data. Multiple brushes compound across dimensions.',
  init,
}
