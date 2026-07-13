import type { Demo } from './types'
import { volumetricHologramDemo } from '../demos/volumetric-hologram'
import { VolumetricHologramControls } from '../demos/volumetric-hologram/Controls'
import { fluidFxDemo } from '../demos/fluid-fx'
import { FluidFxControls } from '../demos/fluid-fx/Controls'
import { pointCloudDemo } from '../demos/point-cloud'
import { PointCloudControls } from '../demos/point-cloud/Controls'
import { imageLabDemo } from '../demos/image-lab'
import { ImageLabControls } from '../demos/image-lab/Controls'
import { semanticSearchDemo } from '../demos/semantic-search'
import { SemanticSearchPanel } from '../demos/semantic-search/Panel'
import { ragLlmDemo } from '../demos/rag-llm'
import { RagChatPanel } from '../demos/rag-llm/Panel'
import { crossfilterDemo } from '../demos/crossfilter'
import { CrossfilterControls } from '../demos/crossfilter/Controls'
import { xpbdDemo } from '../demos/xpbd'
import { XpbdControls } from '../demos/xpbd/Controls'

/**
 * Every demo in the playground, in sidebar order. This is the ONE place that
 * pairs a React-free GPU module with its optional React Controls / Panel —
 * keeping the demo modules themselves importable without React.
 *
 * "Fluid FX" is a multi-mode GPU effects playground (interactive Navier–Stokes
 * fluid, curl-noise particle flow field, and a passive warped color field), all
 * sharing one cosine-palette color picker.
 */
export const demos: Demo[] = [
  { ...volumetricHologramDemo, Controls: VolumetricHologramControls },
  { ...fluidFxDemo, Controls: FluidFxControls },
  { ...pointCloudDemo, Controls: PointCloudControls },
  { ...imageLabDemo, Controls: ImageLabControls },
  { ...crossfilterDemo, Controls: CrossfilterControls },
  { ...xpbdDemo, Controls: XpbdControls },
  { ...semanticSearchDemo, Panel: SemanticSearchPanel },
  { ...ragLlmDemo, Panel: RagChatPanel },
]

export function getDemo(id: string): Demo | undefined {
  return demos.find((d) => d.id === id)
}
