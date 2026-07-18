import type { Digest } from '../../../reduction/types'

interface Props {
  digest: Digest
}

/** The "after" side: the same data post-pipeline. The collapse from many raw
 *  lines to a few clusters is the whole point, so we state it numerically. */
export function ReducedDigest({ digest }: Props) {
  const { clusters, totalEvents, keptEvents, droppedBySample } = digest
  return (
    <section className="obs-col">
      <div className="obs-panel-head">
        <h3>Reduced digest</h3>
        <span className="badge">
          {totalEvents} → {clusters.length}
        </span>
      </div>
      <div className="obs-stream">
        {clusters.length === 0 && <p className="obs-empty">Pipeline output appears here.</p>}
        {clusters.map((c) => (
          <div key={c.id} className={`obs-cluster lvl-${c.level}`}>
            <div className="obs-cluster-head">
              <span className="obs-src">{c.source}</span>
              {c.count > 1 && <span className="obs-count">×{c.count}</span>}
            </div>
            <div className="obs-msg">{c.sample.message}</div>
            {c.sample.headers && (
              <div className="obs-headers">
                {Object.entries(c.sample.headers).map(([k, v]) => (
                  <div key={k}>
                    <span className="obs-hkey">{k}:</span> {v}
                  </div>
                ))}
              </div>
            )}
            {c.frames && c.frames.length > 0 && (
              <div className="obs-frames">
                {c.frames.slice(0, 3).map((f, i) => (
                  <div key={i}>
                    at <span className="obs-fn">{f.fn}</span> ({f.file.split('/').pop()}:{f.line})
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {droppedBySample > 0 && (
        <p className="obs-note">
          Sampling cap dropped {droppedBySample} event{droppedBySample === 1 ? '' : 's'} ({keptEvents} kept).
        </p>
      )}
    </section>
  )
}
