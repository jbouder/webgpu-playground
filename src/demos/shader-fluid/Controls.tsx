import { useEffect, useState } from 'react'
import type { DemoInstance } from '../../gpu/types'
import { PALETTES, type ShaderFluidInstance } from './index'

export function ShaderFluidControls({ instance }: { instance: DemoInstance }) {
  const sf = instance as ShaderFluidInstance
  const p = sf.params

  const [, force] = useState(0)
  const rerender = () => force((n) => n + 1)

  const [scroll, setScroll] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setScroll(sf.getScroll()), 100)
    return () => clearInterval(id)
  }, [sf])

  const activePalette =
    Object.keys(PALETTES).find(
      (name) => PALETTES[name].d.join(',') === p.palette.d.join(','),
    ) ?? ''

  return (
    <div className="controls">
      <h2 className="controls-title">Shader + Fluid</h2>

      <div className="control-group">
        <span className="group-label">Layers</span>
        <label className="control-row control-check">
          <input
            type="checkbox"
            checked={p.showShader}
            onChange={(e) => {
              p.showShader = e.target.checked
              rerender()
            }}
          />
          <span>Shader background</span>
        </label>
        <label className="control-row control-check">
          <input
            type="checkbox"
            checked={p.showFluid}
            onChange={(e) => {
              p.showFluid = e.target.checked
              rerender()
            }}
          />
          <span>Fluid overlay</span>
        </label>
      </div>

      {p.showShader && (
        <div className="control-group">
          <span className="group-label">Shader color</span>
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
      )}

      {p.showFluid && (
        <div className="control-group">
          <span className="group-label">Fluid</span>
          <p className="controls-stat">
            scroll <span>{Math.round(scroll)}</span>
          </p>
          <label className="control-row control-check">
            <input
              type="checkbox"
              checked={p.autoScroll}
              onChange={(e) => {
                p.autoScroll = e.target.checked
                rerender()
              }}
            />
            <span>Auto-scroll</span>
          </label>
          <button type="button" onClick={() => sf.reseed()}>
            Reseed field
          </button>
        </div>
      )}

      <p className="controls-hint">
        Drag/scroll over the canvas drives the fluid · move mouse for the shader
      </p>
    </div>
  )
}
