import type { AnalysisCard } from '../state/analysis'
import type { AnalysisResult, Severity } from '../../../llm/schema'

interface Props {
  cards: AnalysisCard[]
  analyzing: boolean
  structured: boolean
  /** False when the model isn't loaded or the digest is empty. */
  canAnalyze: boolean
  disabledReason: string
  onAnalyze: () => void
  onStop: () => void
}

const SEV_CLASS: Record<Severity, string> = {
  info: 'sev-info',
  warning: 'sev-warn',
  error: 'sev-error',
  critical: 'sev-critical',
}

function StructuredCard({ r }: { r: AnalysisResult }) {
  return (
    <div className="obs-card-body">
      <div className="obs-card-top">
        <span className={`obs-sev ${SEV_CLASS[r.severity]}`}>{r.severity}</span>
        <span className="obs-cat">{r.category}</span>
        {r.confidence && <span className="obs-conf">confidence: {r.confidence}</span>}
      </div>
      {r.pattern && <div className="obs-pattern">{r.pattern}</div>}
      <p className="obs-summary">{r.summary}</p>
      {r.suggestedAction && (
        <p className="obs-action">
          <span className="obs-action-tag">suggested</span> {r.suggestedAction}
        </p>
      )}
    </div>
  )
}

/**
 * The narration layer's output. In structured mode each card is a parsed,
 * schema-constrained object rendered as fields (severity badge, summary,
 * advisory action). In freeform mode it's raw prose — deliberately harder to
 * consume, which is the point of that toggle.
 */
export function AnalysisPanel({ cards, analyzing, structured, canAnalyze, disabledReason, onAnalyze, onStop }: Props) {
  return (
    <section className="obs-analysis">
      <div className="obs-panel-head">
        <h3>Analysis</h3>
        <div className="row-tight">
          {analyzing && (
            <button type="button" className="ghost stop-btn" onClick={onStop}>
              Stop
            </button>
          )}
          <button
            type="button"
            className="obs-analyze-btn"
            onClick={onAnalyze}
            disabled={!canAnalyze || analyzing}
            title={canAnalyze ? '' : disabledReason}
          >
            {analyzing ? 'Analyzing…' : 'Analyze digest'}
          </button>
        </div>
      </div>

      <div className="obs-cards">
        {cards.length === 0 && (
          <p className="obs-empty">
            {canAnalyze
              ? 'Run analysis to narrate the digest. Output is advisory only — nothing here triggers an action.'
              : disabledReason}
          </p>
        )}
        {cards.map((card) => (
          <div key={card.id} className="obs-card">
            <div className="obs-card-label">{card.label}</div>
            {card.error ? (
              <p className="obs-summary error">⚠️ {card.error}</p>
            ) : structured && card.parsed ? (
              <StructuredCard r={card.parsed} />
            ) : structured && card.done && !card.parsed ? (
              <p className="obs-summary error">Model did not return valid JSON. Raw: {card.text.slice(0, 200)}</p>
            ) : (
              <p className="obs-prose">
                {card.text || (!card.done ? <span className="typing">▍</span> : '')}
                {!card.done && card.text && <span className="typing">▍</span>}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
