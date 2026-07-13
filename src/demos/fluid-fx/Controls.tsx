import { useState } from 'react'
import type { DemoInstance } from '../../gpu/types'
import { PALETTES, type FluidFxInstance, type FluidFxMode } from './index'

const MODES: { id: FluidFxMode; label: string; hint: string }[] = [
  { id: 'fluid', label: 'Fluid', hint: 'Drag on the canvas to inject swirling dye.' },
  { id: 'flow', label: 'Flow', hint: 'Curl-noise particle field — drag to push it around.' },
  { id: 'ambient', label: 'Ambient', hint: 'Passive warped color field — move the pointer to bend it.' },
]

export function FluidFxControls({ instance }: { instance: DemoInstance }) {
  const ffx = instance as FluidFxInstance
  const p = ffx.params

  const [, force] = useState(0)
  const rerender = () => force((n) => n + 1)

  const activePalette =
    Object.keys(PALETTES).find((name) => PALETTES[name].d.join(',') === p.palette.d.join(',')) ?? ''
  const modeHint = MODES.find((m) => m.id === p.mode)?.hint ?? ''

  return (
    <div className="controls">
      <h2 className="controls-title">Fluid FX</h2>

      <div className="control-group">
        <span className="group-label">Mode</span>
        <div className="palette-row">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={`chip${p.mode === m.id ? ' is-active' : ''}`}
              onClick={() => {
                p.mode = m.id
                rerender()
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <span className="group-label">Palette</span>
        <div className="palette-row">
          {Object.keys(PALETTES).map((name) => (
            <button
              key={name}
              type="button"
              className={`chip${activePalette === name ? ' is-active' : ''}`}
              onClick={() => {
                p.palette = PALETTES[name]
                rerender()
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <label className="control-row">
          <span>Hue shift</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={p.hue}
            onChange={(e) => {
              p.hue = Number(e.target.value)
              rerender()
            }}
          />
          <span className="control-value">{p.hue.toFixed(2)}</span>
        </label>
      </div>

      {p.mode === 'fluid' && (
        <div className="control-group">
          <span className="group-label">Fluid</span>
          <label className="control-row control-check">
            <input
              type="checkbox"
              checked={p.autoSwirl}
              onChange={(e) => {
                p.autoSwirl = e.target.checked
                rerender()
              }}
            />
            <span>Auto-swirl when idle</span>
          </label>
          <button type="button" onClick={() => ffx.clearFluid()}>
            Clear field
          </button>
        </div>
      )}

      {p.mode === 'flow' && (
        <div className="control-group">
          <span className="group-label">Flow</span>
          <label className="control-row">
            <span>Speed</span>
            <input
              type="range"
              min={0.02}
              max={0.6}
              step={0.01}
              value={p.flowSpeed}
              onChange={(e) => {
                p.flowSpeed = Number(e.target.value)
                rerender()
              }}
            />
            <span className="control-value">{p.flowSpeed.toFixed(2)}</span>
          </label>
          <label className="control-row">
            <span>Trail</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={p.trailLength}
              onChange={(e) => {
                p.trailLength = Number(e.target.value)
                rerender()
              }}
            />
            <span className="control-value">{p.trailLength.toFixed(2)}</span>
          </label>
        </div>
      )}

      {p.mode === 'ambient' && (
        <div className="control-group">
          <span className="group-label">Ambient</span>
          <label className="control-row">
            <span>Speed</span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={p.ambientSpeed}
              onChange={(e) => {
                p.ambientSpeed = Number(e.target.value)
                rerender()
              }}
            />
            <span className="control-value">{p.ambientSpeed.toFixed(2)}</span>
          </label>
          <label className="control-row">
            <span>Warp</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={p.ambientWarp}
              onChange={(e) => {
                p.ambientWarp = Number(e.target.value)
                rerender()
              }}
            />
            <span className="control-value">{p.ambientWarp.toFixed(2)}</span>
          </label>
        </div>
      )}

      <p className="controls-hint">{modeHint}</p>
    </div>
  )
}
