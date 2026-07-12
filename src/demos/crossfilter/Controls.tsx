import { useEffect, useReducer, useState } from 'react'
import type { DemoInstance } from '../../gpu/types'
import { binCenter, DIMENSIONS, ROW_COUNT_OPTIONS } from './data'
import type { CrossfilterInstance } from './index'

const rgb = (c: [number, number, number]) =>
  `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`

export function CrossfilterControls({ instance }: { instance: DemoInstance }) {
  const inst = instance as CrossfilterInstance
  const { engine } = inst

  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [rowCount, setRowCount] = useState(engine.rowCount || 1_000_000)

  useEffect(() => {
    inst.onStateChange = () => bump()
    return () => {
      inst.onStateChange = null
    }
  }, [inst])

  const activeBrushes = engine.brushes
    .map((b, dim) => ({ b, dim }))
    .filter((x) => x.b) as { b: { lo: number; hi: number }; dim: number }[]

  const changeRows = async (n: number) => {
    setRowCount(n)
    await inst.setRowCount(n)
  }

  return (
    <div className="controls xf-controls">
      <h2 className="controls-title">Crossfilter</h2>

      <div className="control-group">
        <span className="group-label">Rows</span>
        <div className="palette-row">
          {ROW_COUNT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`chip ${rowCount === opt.value ? 'is-active' : ''}`}
              onClick={() => changeRows(opt.value)}
              disabled={inst.busy}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="controls-stat">
          {inst.busy ? (
            'Generating dataset…'
          ) : (
            <>
              <span>{engine.rowCount.toLocaleString()}</span> rows ·{' '}
              <span>{engine.filteredTotal().toLocaleString()}</span> pass filter
            </>
          )}
        </p>
      </div>

      <div className="control-group">
        <span className="group-label">Panels</span>
        {inst.panels.map((panel, p) => {
          const brush = panel.dim >= 0 ? engine.brushes[panel.dim] : null
          const dim = panel.dim >= 0 ? DIMENSIONS[panel.dim] : null
          return (
            <div key={p} className="xf-legend-row">
              <span className="xf-swatch" style={{ background: rgb(panel.color) }} />
              <span className="xf-legend-label">{panel.label}</span>
              {brush && dim && (
                <span className="xf-legend-range">
                  {dim.format(binCenter(dim, brush.lo))} – {dim.format(binCenter(dim, brush.hi))}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {inst.hover && (
        <div className="control-group xf-hover">
          <span className="group-label">Hover</span>
          <p className="controls-stat">
            {inst.hover.label} ≈ {inst.hover.value} · <span>{inst.hover.count.toLocaleString()}</span>{' '}
            rows
          </p>
        </div>
      )}

      <button
        type="button"
        className="ghost xf-reset"
        onClick={() => inst.reset()}
        disabled={activeBrushes.length === 0}
      >
        Clear {activeBrushes.length || ''} brush{activeBrushes.length === 1 ? '' : 'es'}
      </button>

      <p className="controls-hint">
        Drag across any histogram to brush a range; every other panel refilters live. Brushes
        compound across dimensions. Click a panel without dragging to clear its brush. All
        aggregation runs on the GPU — the CPU never rescans the rows.
      </p>
    </div>
  )
}
