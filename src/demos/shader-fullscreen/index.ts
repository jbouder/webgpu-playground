import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import shaderSource from './shader.wgsl?raw'

// Uniform layout (std140-ish). 8 floats = 32 bytes, 16-byte aligned:
//   [0,1] resolution.xy
//   [2]   time
//   [3]   _pad0
//   [4,5] mouse.xy
//   [6,7] padding
const UNIFORM_FLOATS = 8
const UNIFORM_BYTES = UNIFORM_FLOATS * 4

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx

  const module = device.createShaderModule({
    label: 'fullscreen-shader',
    code: shaderSource,
  })

  const uniformBuffer = device.createBuffer({
    label: 'fullscreen-uniforms',
    size: UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const pipeline = device.createRenderPipeline({
    label: 'fullscreen-pipeline',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })

  const bindGroup = device.createBindGroup({
    label: 'fullscreen-bindgroup',
    layout: pipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  })

  const uniforms = new Float32Array(UNIFORM_FLOATS)

  // Mouse tracked in device pixels (matches @builtin(position) space).
  let mouseX = 0
  let mouseY = 0
  const onPointerMove = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / Math.max(rect.width, 1)
    const scaleY = canvas.height / Math.max(rect.height, 1)
    mouseX = (e.clientX - rect.left) * scaleX
    mouseY = (e.clientY - rect.top) * scaleY
  }
  canvas.addEventListener('pointermove', onPointerMove)

  const frame = (_dt: number, elapsed: number) => {
    uniforms[0] = canvas.width
    uniforms[1] = canvas.height
    uniforms[2] = elapsed
    uniforms[4] = mouseX
    uniforms[5] = mouseY
    device.queue.writeBuffer(uniformBuffer, 0, uniforms)

    const encoder = device.createCommandEncoder({ label: 'fullscreen-frame' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
  }

  const dispose = () => {
    canvas.removeEventListener('pointermove', onPointerMove)
    uniformBuffer.destroy()
  }

  return { frame, dispose }
}

export const shaderFullscreenDemo: Demo = {
  id: 'shader-fullscreen',
  title: 'Animated Shader',
  description:
    'A Shadertoy-style fragment shader over a fullscreen triangle. Uniforms carry time, resolution, and pointer position. Move the mouse over the canvas.',
  init,
}
