import type { Demo } from './types'
import { shaderFluidDemo } from '../demos/shader-fluid'
import { ShaderFluidControls } from '../demos/shader-fluid/Controls'
import { pointCloudDemo } from '../demos/point-cloud'
import { PointCloudControls } from '../demos/point-cloud/Controls'
import { semanticSearchDemo } from '../demos/semantic-search'
import { SemanticSearchPanel } from '../demos/semantic-search/Panel'

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
  { ...shaderFluidDemo, Controls: ShaderFluidControls },
  { ...pointCloudDemo, Controls: PointCloudControls },
  { ...semanticSearchDemo, Panel: SemanticSearchPanel },
]

export function getDemo(id: string): Demo | undefined {
  return demos.find((d) => d.id === id)
}
