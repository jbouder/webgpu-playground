import { useEffect, useState } from 'react'
import type { DemoInstance } from '../../gpu/types'
import type { FluidScrollInstance } from './index'

export function FluidScrollControls({ instance }: { instance: DemoInstance }) {
  const fs = instance as FluidScrollInstance

  const [autoScroll, setAutoScroll] = useState(fs.params.autoScroll)
  const [scroll, setScroll] = useState(0)

  // Poll the scroll readout cheaply rather than spinning a second RAF loop.
  useEffect(() => {
    const id = setInterval(() => setScroll(fs.getScroll()), 100)
    return () => clearInterval(id)
  }, [fs])

  return (
    <div className="controls">
      <h2 className="controls-title">Fluid Scroll</h2>

      <p className="controls-stat">
        scroll <span>{Math.round(scroll)}</span>
      </p>

      <label className="control-row control-check">
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={(e) => {
            fs.params.autoScroll = e.target.checked
            setAutoScroll(e.target.checked)
          }}
        />
        <span>Auto-scroll</span>
      </label>

      <button type="button" onClick={() => fs.reseed()}>
        Reseed field
      </button>

      <p className="controls-hint">
        Scroll (wheel / trackpad) over the canvas — speed advects the field,
        position drives pattern &amp; color.
      </p>
    </div>
  )
}
