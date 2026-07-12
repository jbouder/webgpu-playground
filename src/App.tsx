import { useMemo, useState } from 'react'
import { CanvasHost } from './host/CanvasHost'
import { Sidebar } from './host/Sidebar'
import { demos, getDemo } from './gpu/registry'
import type { DemoInstance } from './gpu/types'

export default function App() {
  const [activeId, setActiveId] = useState(demos[0]?.id ?? '')
  const [instance, setInstance] = useState<DemoInstance | null>(null)

  const demo = useMemo(() => getDemo(activeId), [activeId])
  const Controls = demo?.Controls
  const Panel = demo?.Panel

  const handleSelect = (id: string) => {
    if (id === activeId) return
    setInstance(null)
    setActiveId(id)
  }

  return (
    <div className="app">
      <Sidebar activeId={activeId} onSelect={handleSelect} />

      <div className="workspace">
        {demo && (
          <header className="demo-header">
            <h1>{demo.title}</h1>
            <p>{demo.description}</p>
          </header>
        )}

        <main className="app-main">
          {!demo ? (
            <div className="canvas-host">
              <div className="canvas-overlay">
                <p className="status status-warn">No demos registered.</p>
              </div>
            </div>
          ) : Panel ? (
            // DOM-primary demo: takes over the whole main area, no canvas.
            <Panel key={demo.id} />
          ) : (
            <>
              {/* key forces a fresh CanvasHost (full dispose/init) per swap. */}
              <CanvasHost key={demo.id} demo={demo} onInstance={setInstance} />
              {Controls && instance && (
                <aside className="controls-panel">
                  <Controls instance={instance} />
                </aside>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  )
}
