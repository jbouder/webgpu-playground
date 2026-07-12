import { useReducer } from 'react'
import type { DemoInstance } from '../../gpu/types'
import { defaultFilters, type ImageFilters } from '../../lib/gpu-image'
import type { WebcamFxInstance } from './index'

interface SliderSpec {
  key: keyof ImageFilters
  label: string
  min: number
  max: number
  step: number
  fmt: (v: number) => string
}

const SLIDERS: SliderSpec[] = [
  { key: 'brightness', label: 'Exposure', min: -1.5, max: 1.5, step: 0.05, fmt: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)} EV` },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.02, fmt: (v) => `${v.toFixed(2)}×` },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.02, fmt: (v) => `${v.toFixed(2)}×` },
  { key: 'temperature', label: 'Temperature', min: -1, max: 1, step: 0.05, fmt: (v) => (v === 0 ? 'neutral' : `${v > 0 ? 'warm' : 'cool'} ${Math.abs(v).toFixed(2)}`) },
  { key: 'blur', label: 'Blur', min: 0, max: 40, step: 1, fmt: (v) => `${v.toFixed(0)}px` },
  { key: 'sharpen', label: 'Sharpen', min: 0, max: 2, step: 0.05, fmt: (v) => v.toFixed(2) },
  { key: 'edges', label: 'Edges', min: 0, max: 1, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 1, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
]

const PRESETS: Array<{ name: string; filters: Partial<ImageFilters> }> = [
  { name: 'Natural', filters: {} },
  { name: 'B&W', filters: { grayscale: 1, contrast: 1.12 } },
  { name: 'Edges', filters: { edges: 0.85, saturation: 0, contrast: 1.1 } },
  { name: 'Dreamy', filters: { blur: 6, brightness: 0.25, saturation: 1.25, vignette: 0.3 } },
  { name: 'Cool', filters: { temperature: -0.5, saturation: 1.1, contrast: 1.05 } },
  { name: 'Warm', filters: { temperature: 0.5, saturation: 1.1, vignette: 0.2 } },
]

export function WebcamFxControls({ instance }: { instance: DemoInstance }) {
  // The demo module owns the concrete type; the registry only knows DemoInstance.
  const inst = instance as WebcamFxInstance
  const [, bump] = useReducer((n: number) => n + 1, 0)

  const setFilter = (key: keyof ImageFilters, v: number) => {
    inst.params[key] = v
    bump()
  }

  const applyPreset = (filters: Partial<ImageFilters>) => {
    Object.assign(inst.params, defaultFilters(), filters)
    bump()
  }

  const splitOn = inst.params.split >= 0

  return (
    <div className="controls">
      <h2 className="controls-title">Webcam FX</h2>

      <p className="controls-stat">
        Live feed: <span>{inst.info.width}×{inst.info.height}</span>
      </p>

      <div className="control-group">
        <span className="group-label">Presets</span>
        <div className="palette-row">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className="chip"
              onClick={() => applyPreset(p.filters)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <span className="group-label">Filters</span>
        {SLIDERS.map((s) => {
          const value = inst.params[s.key]
          return (
            <label className="control-row" key={s.key}>
              <span>{s.label}</span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={value}
                onChange={(e) => setFilter(s.key, Number(e.target.value))}
              />
              <span className="control-value">{s.fmt(value)}</span>
            </label>
          )
        })}
      </div>

      <div className="control-group">
        <span className="group-label">View</span>
        <label className="control-row control-check">
          <input
            type="checkbox"
            checked={inst.params.mirror}
            onChange={(e) => {
              inst.params.mirror = e.target.checked
              bump()
            }}
          />
          <span>Mirror (selfie)</span>
        </label>
        <label className="control-row control-check">
          <input
            type="checkbox"
            checked={splitOn}
            onChange={(e) => {
              inst.params.split = e.target.checked ? 0.5 : -1
              bump()
            }}
          />
          <span>Before / after split</span>
        </label>
        <label className="control-row">
          <span>Position</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={splitOn ? inst.params.split : 0.5}
            disabled={!splitOn}
            onChange={(e) => {
              inst.params.split = Number(e.target.value)
              bump()
            }}
          />
          <span className="control-value">{splitOn ? `${Math.round(inst.params.split * 100)}%` : '—'}</span>
        </label>
      </div>

      <div className="row">
        <button type="button" className="ghost" onClick={() => inst.snapshot()}>
          📷 Snapshot PNG
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            inst.reset()
            bump()
          }}
        >
          Reset filters
        </button>
      </div>

      <p className="controls-hint">
        Every frame is copied into a GPU texture and run through the same compute filter chain as
        Image Lab. The feed never leaves your machine.
      </p>
    </div>
  )
}
