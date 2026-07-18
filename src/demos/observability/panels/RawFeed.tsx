import { useEffect, useRef } from 'react'
import type { SignalEvent } from '../../../capture/types'

interface Props {
  events: SignalEvent[]
}

/** The unfiltered stream, newest at the bottom. This is the "before" side of
 *  the before/after: every captured signal, repeats and all. */
export function RawFeed({ events }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [events])

  // Render only the tail — a flood can be thousands of lines.
  const shown = events.slice(-300)

  return (
    <section className="obs-col">
      <div className="obs-panel-head">
        <h3>Raw feed</h3>
        <span className="badge">{events.length}</span>
      </div>
      <div className="obs-stream" ref={scrollRef}>
        {events.length === 0 && <p className="obs-empty">No signals yet. Hit an inject button →</p>}
        {shown.map((e) => (
          <div key={e.id} className={`obs-line lvl-${e.level}`}>
            <span className="obs-src">{e.source}</span>
            <span className="obs-msg">{e.message}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
