import { useState } from 'react'
import type { DemoInstance } from '../../gpu/types'
import type { HolotableInstance } from './index'

export function HolotableControls({ instance }: { instance: DemoInstance }) {
  const holotable = instance as HolotableInstance
  const p = holotable.params
  const [, force] = useState(0)
  const rerender = () => force((n) => n + 1)

  return (
    <div className="controls">
      <h2 className="controls-title">Holotable</h2>
      <div className="control-group">
        <span className="group-label">Camera</span>
        <label className="control-row control-check">
          <input type="checkbox" checked={p.autoRotate} onChange={(e) => {
            p.autoRotate = e.target.checked
            rerender()
          }} />
          <span>Auto-rotate</span>
        </label>
        <button type="button" onClick={() => {
          holotable.resetCamera()
          rerender()
        }}>Reset camera</button>
      </div>
      <div className="control-group">
        <span className="group-label">Volume</span>
        <label className="control-row">
          <span>Steps</span>
          <input type="range" min={32} max={192} step={1} value={p.steps} onChange={(e) => {
            p.steps = Number(e.target.value)
            rerender()
          }} />
          <span className="control-value">{p.steps}</span>
        </label>
        <label className="control-row">
          <span>Density</span>
          <input type="range" min={0} max={2} step={0.01} value={p.densityScale} onChange={(e) => {
            p.densityScale = Number(e.target.value)
            rerender()
          }} />
          <span className="control-value">{p.densityScale.toFixed(2)}</span>
        </label>
        <label className="control-row">
          <span>Hue</span>
          <input type="range" min={0} max={1} step={0.01} value={p.hue} onChange={(e) => {
            p.hue = Number(e.target.value)
            rerender()
          }} />
          <span className="control-value">{p.hue.toFixed(2)}</span>
        </label>
      </div>
      <div className="control-group">
        <span className="group-label">Hologram</span>
        <label className="control-row">
          <span>Fresnel</span>
          <input type="range" min={0} max={1} step={0.01} value={p.fresnel} onChange={(e) => {
            p.fresnel = Number(e.target.value)
            rerender()
          }} />
          <span className="control-value">{p.fresnel.toFixed(2)}</span>
        </label>
        <label className="control-row">
          <span>Scanlines</span>
          <input type="range" min={0} max={1} step={0.01} value={p.scanlines} onChange={(e) => {
            p.scanlines = Number(e.target.value)
            rerender()
          }} />
          <span className="control-value">{p.scanlines.toFixed(2)}</span>
        </label>
        <label className="control-row">
          <span>Chroma</span>
          <input type="range" min={0} max={1} step={0.01} value={p.chroma} onChange={(e) => {
            p.chroma = Number(e.target.value)
            rerender()
          }} />
          <span className="control-value">{p.chroma.toFixed(2)}</span>
        </label>
        <label className="control-row">
          <span>Flicker</span>
          <input type="range" min={0} max={1} step={0.01} value={p.flicker} onChange={(e) => {
            p.flicker = Number(e.target.value)
            rerender()
          }} />
          <span className="control-value">{p.flicker.toFixed(2)}</span>
        </label>
      </div>
      <p className="controls-hint">Drag to orbit · scroll not required.</p>
    </div>
  )
}
