import type { Demo } from './types'
import { volumetricHologramDemo } from '../demos/volumetric-hologram'
import { VolumetricHologramControls } from '../demos/volumetric-hologram/Controls'
import { shaderFluidDemo } from '../demos/shader-fluid'
import { ShaderFluidControls } from '../demos/shader-fluid/Controls'
import { pointCloudDemo } from '../demos/point-cloud'
import { PointCloudControls } from '../demos/point-cloud/Controls'
import { imageLabDemo } from '../demos/image-lab'
import { ImageLabControls } from '../demos/image-lab/Controls'
import { webcamFxDemo } from '../demos/webcam-fx'
import { WebcamFxControls } from '../demos/webcam-fx/Controls'
import { semanticSearchDemo } from '../demos/semantic-search'
import { SemanticSearchPanel } from '../demos/semantic-search/Panel'
import { ragLlmDemo } from '../demos/rag-llm'
import { RagChatPanel } from '../demos/rag-llm/Panel'
import { soundMixerDemo } from '../demos/sound-mixer'
import { SoundMixerControls } from '../demos/sound-mixer/Controls'
import { crossfilterDemo } from '../demos/crossfilter'
import { CrossfilterControls } from '../demos/crossfilter/Controls'
import { xpbdDemo } from '../demos/xpbd'
import { XpbdControls } from '../demos/xpbd/Controls'

/**
 * Every demo in the playground, in sidebar order. This is the ONE place that
 * pairs a React-free GPU module with its optional React Controls / Panel —
 * keeping the demo modules themselves importable without React.
 *
 * "Shader + Fluid" combines the animated shader and the reaction-diffusion
 * fluid into one composited, layer-toggleable demo. The standalone
 * shader-fullscreen and fluid-scroll modules still live under src/demos/ and
 * are reused by it.
 */
export const demos: Demo[] = [
  { ...volumetricHologramDemo, Controls: VolumetricHologramControls },
  { ...shaderFluidDemo, Controls: ShaderFluidControls },
  { ...pointCloudDemo, Controls: PointCloudControls },
  { ...imageLabDemo, Controls: ImageLabControls },
  { ...webcamFxDemo, Controls: WebcamFxControls },
  { ...soundMixerDemo, Controls: SoundMixerControls },
  { ...crossfilterDemo, Controls: CrossfilterControls },
  { ...xpbdDemo, Controls: XpbdControls },
  { ...semanticSearchDemo, Panel: SemanticSearchPanel },
  { ...ragLlmDemo, Panel: RagChatPanel },
]

export function getDemo(id: string): Demo | undefined {
  return demos.find((d) => d.id === id)
}
