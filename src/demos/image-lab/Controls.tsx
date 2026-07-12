import { useEffect, useReducer, useState } from 'react'
import type { DemoInstance } from '../../gpu/types'
import type { MediaLabInstance } from './index'

interface SliderSpec {
  key: keyof MediaLabInstance['params']
  label: string
  min: number
  max: number
  step: number
  /** Format the current value for the readout. */
  fmt: (v: number) => string
}

// Photo-pipeline order, top to bottom.
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

export function ImageLabControls({ instance }: { instance: DemoInstance }) {
  // The demo module owns the concrete type; the registry only knows DemoInstance.
  const inst = instance as MediaLabInstance

  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cameraActive, setCameraActive] = useState(false)

  useEffect(() => {
    inst.onImageChange = () => bump()
    return () => {
      inst.onImageChange = null
    }
  }, [inst])

  const setFilter = (key: SliderSpec['key'], v: number) => {
    inst.params[key] = v
    inst.markDirty()
    bump()
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-upload of the same file
    if (!file) return
    setLoading(true)
    setError('')
    try {
      await inst.loadFile(file)
    } catch {
      setError('Could not decode that image.')
    } finally {
      setLoading(false)
    }
  }

  const splitOn = inst.params.split >= 0

  const startCamera = async () => {
    setLoading(true)
    setError('')
    try {
      await inst.startCamera()
      setCameraActive(true)
      bump()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the camera.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="controls">
      <h2 className="controls-title">Media Lab</h2>

      <p className="controls-stat">
        {cameraActive ? 'Live feed' : 'Source'}: <span>{inst.info.width}×{inst.info.height}</span>
      </p>

      <div className="control-group">
        <span className="group-label">Source</span>
        <label className="file-btn mixer-add">
          {loading ? 'Decoding…' : '⬆ Upload image'}
          <input type="file" accept="image/*" hidden onChange={(e) => {
            setCameraActive(false)
            void onFile(e)
          }} disabled={loading} />
        </label>
        <div className="row">
          <button type="button" className="ghost" onClick={() => void startCamera()} disabled={loading || cameraActive}>
            📷 Use camera
          </button>
          {cameraActive && (
            <button type="button" className="ghost" onClick={() => {
              inst.stopCamera()
              setCameraActive(false)
              bump()
            }}>
              Stop camera
            </button>
          )}
        </div>
        {error && <p className="panel-status-sub error">{error}</p>}
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
        <span className="group-label">Compare</span>
        {cameraActive && (
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
        )}
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

      <button
        type="button"
        className="xf-reset"
        onClick={() => {
          inst.reset()
          bump()
        }}
      >
        Reset filters
      </button>

      <p className="controls-hint">
        Each filter is a WebGPU compute pass over ping-pong textures. Live video runs every frame;
        images only re-run when a value changes. Left of the split shows the untouched original.
      </p>
    </div>
  )
}
