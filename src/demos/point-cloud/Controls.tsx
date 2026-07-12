import { useState } from 'react'
import type { DemoInstance } from '../../gpu/types'
import type { PointCloudInstance } from './index'

export function PointCloudControls({ instance }: { instance: DemoInstance }) {
  // The demo module owns the concrete type; the registry only knows DemoInstance.
  const pc = instance as PointCloudInstance

  const [pointSize, setPointSize] = useState(pc.params.pointSize)
  const [autoRotate, setAutoRotate] = useState(pc.params.autoRotate)
  const [spinSpeed, setSpinSpeed] = useState(pc.params.spinSpeed)
  const [activePoints, setActivePoints] = useState(pc.params.activePoints)

  return (
    <div className="controls">
      <h2 className="controls-title">Point Cloud</h2>

      <label className="control-row">
        <span>Points</span>
        <input
          type="range"
          min={1000}
          max={pc.maxPoints}
          step={1000}
          value={activePoints}
          onChange={(e) => {
            const v = Number(e.target.value)
            pc.params.activePoints = v
            setActivePoints(v)
          }}
        />
        <span className="control-value">{activePoints.toLocaleString()}</span>
      </label>

      <label className="control-row">
        <span>Point size</span>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={pointSize}
          onChange={(e) => {
            const v = Number(e.target.value)
            pc.params.pointSize = v
            setPointSize(v)
          }}
        />
        <span className="control-value">{pointSize.toFixed(1)}px</span>
      </label>

      <label className="control-row control-check">
        <input
          type="checkbox"
          checked={autoRotate}
          onChange={(e) => {
            pc.params.autoRotate = e.target.checked
            setAutoRotate(e.target.checked)
          }}
        />
        <span>Auto-rotate</span>
      </label>

      <label className="control-row">
        <span>Spin speed</span>
        <input
          type="range"
          min={0}
          max={0.6}
          step={0.02}
          value={spinSpeed}
          disabled={!autoRotate}
          onChange={(e) => {
            const v = Number(e.target.value)
            pc.params.spinSpeed = v
            setSpinSpeed(v)
          }}
        />
        <span className="control-value">{spinSpeed.toFixed(2)}</span>
      </label>

      <p className="controls-hint">Drag to orbit · scroll to zoom</p>
    </div>
  )
}
