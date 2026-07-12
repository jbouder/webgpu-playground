import type { Demo, DemoContext, DemoInstance } from '../../gpu/types'
import { AudioAnalyserBridge } from '../../lib/audio'
import { SoundMixer } from './mixer'
import shaderSource from './shader.wgsl?raw'

export interface SoundMixerInstance extends DemoInstance {
  mixer: SoundMixer
  params: {
    /** Visual response multiplier applied to spectrum magnitudes. */
    sensitivity: number
  }
}

// Uniform layout (std140-ish): res.xy, time, bass, mid, treble, level, sens,
// bins — 9 floats, padded to 12 (48 bytes).
const U_FLOATS = 12

async function init(ctx: DemoContext): Promise<DemoInstance> {
  const { device, context, format, canvas } = ctx

  const mixer = new SoundMixer(512)
  mixer.loadBuiltins()
  const bridge = new AudioAnalyserBridge(mixer.analyser)
  // Create the spectrum buffer up front (before any writes) so bind groups can
  // reference it immediately.
  bridge.writeToGPU(device)

  const module = device.createShaderModule({ label: 'mixer-viz', code: shaderSource })

  const uniformBuffer = device.createBuffer({
    label: 'mixer-uniform',
    size: U_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

  const pipeline = device.createRenderPipeline({
    label: 'mixer-viz-pipeline',
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  })

  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniformBuffer } },
      { binding: 1, resource: { buffer: bridge.freqBuffer } },
    ],
  })

  const params: SoundMixerInstance['params'] = { sensitivity: 1.4 }
  const u = new Float32Array(U_FLOATS)

  const frame = (_dt: number, elapsed: number) => {
    // Pull the FFT and push the spectrum to the GPU before drawing.
    bridge.update()
    bridge.writeToGPU(device)
    const { bass, mid, treble, level } = bridge.bands

    u[0] = canvas.width
    u[1] = canvas.height
    u[2] = elapsed
    u[3] = bass
    u[4] = mid
    u[5] = treble
    u[6] = level
    u[7] = params.sensitivity
    u[8] = bridge.bins
    device.queue.writeBuffer(uniformBuffer, 0, u)

    const encoder = device.createCommandEncoder({ label: 'mixer-frame' })
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: context.getCurrentTexture().createView(),
          clearValue: { r: 0.02, g: 0.02, b: 0.04, a: 1 },
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
    mixer.dispose()
    bridge.dispose()
    uniformBuffer.destroy()
  }

  const instance: SoundMixerInstance = { frame, dispose, mixer, params }
  return instance
}

// Canvas demo: the mixer's master output feeds an AnalyserNode whose FFT drives
// the visualization. The Controls panel (registry-wired) owns the mixer UI.
export const soundMixerDemo: Demo = {
  id: 'sound-mixer',
  title: 'Sound Mixer',
  description:
    'A multi-track sound mixer with a live WebGPU visualizer. Play the built-in loops or drop in your own audio, then ride the faders — per-track volume, pan, mute, and solo. The mixed output drives a radial spectrum analyzer rendered on the GPU.',
  init,
}
