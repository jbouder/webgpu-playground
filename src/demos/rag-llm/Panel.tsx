import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '../../lib/vector-store'
import { DEFAULT_LLM, LLM_MODELS, RagEngine } from './index'

type Status = 'loading' | 'ready' | 'error'

interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  sources?: SearchResult[]
  stats?: string
  pending?: boolean
}

const SAMPLE_DOC = `The Apollo program was a series of human spaceflight missions run by NASA between 1961 and 1972. Its central goal, set by President John F. Kennedy in 1961, was to land a man on the Moon and return him safely to Earth before the end of the decade.

Apollo 11 achieved that goal on July 20, 1969, when Neil Armstrong and Buzz Aldrin became the first humans to walk on the lunar surface while Michael Collins orbited above in the command module. Armstrong's first words on the Moon were "That's one small step for man, one giant leap for mankind."

The program used the Saturn V rocket, a three-stage launch vehicle that remains the most powerful rocket ever to fly successfully. Each Saturn V stood over 110 meters tall and produced roughly 34 million newtons of thrust at liftoff.

Six of the Apollo missions — 11, 12, 14, 15, 16, and 17 — successfully landed astronauts on the Moon. Apollo 13 suffered an oxygen tank explosion on the way to the Moon and had to abort its landing, but the crew returned safely to Earth in an improvised rescue that became famous as a "successful failure."

The last crewed mission to the Moon was Apollo 17 in December 1972. Since then, no humans have travelled beyond low Earth orbit, though several agencies now plan a return.`

export function RagChatPanel() {
  const engineRef = useRef<RagEngine | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')

  const [embedProgress, setEmbedProgress] = useState<{ msg: string; value: number }>({
    msg: 'Starting…',
    value: -1,
  })
  const [llmProgress, setLlmProgress] = useState<{ msg: string; value: number }>({
    msg: 'Waiting…',
    value: -1,
  })
  const [stage, setStage] = useState<'embed' | 'llm'>('embed')
  const [model, setModel] = useState(DEFAULT_LLM)

  const [docText, setDocText] = useState('')
  const [indexedChunks, setIndexedChunks] = useState(0)
  const [indexing, setIndexing] = useState(false)

  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [query, setQuery] = useState('')
  const [generating, setGenerating] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Create the engine and load both models (embedder first, then LLM).
  useEffect(() => {
    const engine = new RagEngine()
    engineRef.current = engine
    engine.onEmbedProgress = (p) => setEmbedProgress({ msg: p.message, value: p.progress })
    engine.onLlmProgress = (p) => setLlmProgress({ msg: p.message, value: p.progress })

    let cancelled = false
    ;(async () => {
      try {
        setStage('embed')
        await engine.loadEmbedder()
        if (cancelled) return
        setStage('llm')
        await engine.loadLlm(DEFAULT_LLM)
        if (cancelled) return
        setStatus('ready')
      } catch (err) {
        if (cancelled) return
        setErrorMsg(err instanceof Error ? err.message : String(err))
        setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  // Auto-scroll the transcript as tokens stream in.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [turns])

  const handleSwapModel = async (id: string) => {
    const engine = engineRef.current
    if (!engine || id === model || generating) return
    setModel(id)
    setStatus('loading')
    setStage('llm')
    setLlmProgress({ msg: 'Switching model…', value: -1 })
    try {
      await engine.loadLlm(id)
      setStatus('ready')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStatus('error')
    }
  }

  const handleIndex = async () => {
    const engine = engineRef.current
    if (!engine || !docText.trim()) return
    setIndexing(true)
    setErrorMsg('')
    try {
      engine.clear()
      const { chunks } = await engine.indexText(docText)
      setIndexedChunks(chunks)
      setTurns([])
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setIndexing(false)
    }
  }

  const handleAsk = async () => {
    const engine = engineRef.current
    const q = query.trim()
    if (!engine || !q || engine.size === 0 || generating) return

    setQuery('')
    setGenerating(true)
    setErrorMsg('')
    // Push the user turn plus a pending assistant turn we stream into.
    setTurns((t) => [...t, { role: 'user', content: q }, { role: 'assistant', content: '', pending: true }])

    const appendToLast = (patch: Partial<ChatTurn>) =>
      setTurns((t) => {
        const next = t.slice()
        const last = next[next.length - 1]
        next[next.length - 1] = {
          ...last,
          ...patch,
          content: patch.content !== undefined ? patch.content : last.content,
        }
        return next
      })

    try {
      let acc = ''
      const { stats } = await engine.answer(q, {
        onSources: (sources) => appendToLast({ sources }),
        onToken: (tok) => {
          acc += tok
          appendToLast({ content: acc })
        },
      })
      appendToLast({ content: acc, stats, pending: false })
    } catch (err) {
      appendToLast({
        content: `⚠️ ${err instanceof Error ? err.message : String(err)}`,
        pending: false,
      })
    } finally {
      setGenerating(false)
    }
  }

  const pct = (v: number) => (v >= 0 ? Math.round(v * 100) : null)

  if (status === 'loading') {
    const embedPct = pct(embedProgress.value)
    const llmPct = pct(llmProgress.value)
    return (
      <div className="panel">
        <div className="panel-status">
          <div className="spinner" />
          <div>
            <p className="panel-status-title">
              {stage === 'embed' ? 'Loading embedding model…' : 'Loading language model…'}
            </p>
            <div className="load-stage">
              <span>1. Embedder</span>
              <div className="progress-track">
                <div
                  className="progress-fill"
                  style={{ width: `${embedPct ?? (stage === 'embed' ? 5 : 100)}%` }}
                />
              </div>
              <span className="panel-status-sub">{embedProgress.msg}</span>
            </div>
            <div className="load-stage">
              <span>2. Language model</span>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${llmPct ?? 0}%` }} />
              </div>
              <span className="panel-status-sub">
                {stage === 'llm' ? llmProgress.msg : 'Waiting…'}
                {llmPct !== null ? ` — ${llmPct}%` : ''}
              </span>
            </div>
            <p className="panel-status-note">
              First load downloads both models (~1&nbsp;GB total) and caches them in the browser.
              Subsequent loads are fast.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="panel">
        <div className="panel-status">
          <div>
            <p className="panel-status-title error">Failed to load models</p>
            <p className="panel-status-sub">{errorMsg}</p>
            <p className="panel-status-note">
              WebLLM needs WebGPU with sufficient VRAM. Try a smaller model, or a recent
              Chrome/Edge with hardware acceleration enabled.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="semantic-grid">
        {/* Document column */}
        <section className="semantic-col">
          <div className="col-head">
            <h3>Document</h3>
            <select
              className="model-select"
              value={model}
              onChange={(e) => handleSwapModel(e.target.value)}
              disabled={generating}
              title="Language model"
            >
              {LLM_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} · {m.size}
                </option>
              ))}
            </select>
          </div>
          <textarea
            className="doc-input"
            placeholder="Paste text here, or upload a .txt / .md file…"
            value={docText}
            onChange={(e) => setDocText(e.target.value)}
          />
          <div className="row">
            <label className="file-btn">
              Upload file
              <input
                type="file"
                accept=".txt,.md,text/*"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (file) setDocText(await file.text())
                }}
              />
            </label>
            <button type="button" className="ghost" onClick={() => setDocText(SAMPLE_DOC)}>
              Use sample
            </button>
            <button type="button" onClick={handleIndex} disabled={indexing || !docText.trim()}>
              {indexing ? 'Indexing…' : 'Index document'}
            </button>
          </div>
          {indexedChunks > 0 && !indexing && (
            <p className="ok-note">
              Indexed {indexedChunks} chunk{indexedChunks === 1 ? '' : 's'}. Ask a question →
            </p>
          )}
        </section>

        {/* Chat column */}
        <section className="semantic-col">
          <div className="col-head">
            <h3>Chat</h3>
            {generating && (
              <button type="button" className="ghost stop-btn" onClick={() => engineRef.current?.interrupt()}>
                Stop
              </button>
            )}
          </div>

          <div className="chat-log" ref={scrollRef}>
            {turns.length === 0 && (
              <p className="panel-status-sub">
                {indexedChunks === 0
                  ? 'Index a document, then ask a grounded question.'
                  : 'Ask a question about the document.'}
              </p>
            )}
            {turns.map((turn, i) => (
              <div key={i} className={`chat-turn ${turn.role}`}>
                <div className="chat-bubble">
                  {turn.content || (turn.pending ? <span className="typing">▍</span> : '')}
                </div>
                {turn.sources && turn.sources.length > 0 && (
                  <details className="chat-sources">
                    <summary>{turn.sources.length} retrieved passages</summary>
                    <ol>
                      {turn.sources.map((s, j) => (
                        <li key={s.index}>
                          <span className="src-tag">
                            [{j + 1}] {s.score.toFixed(3)}
                          </span>{' '}
                          {s.text}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
                {turn.stats && <span className="chat-stats">{turn.stats}</span>}
              </div>
            ))}
          </div>

          <div className="row">
            <input
              className="query-input"
              type="text"
              placeholder="Ask about the document…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              disabled={generating}
            />
            <button
              type="button"
              onClick={handleAsk}
              disabled={generating || !query.trim() || indexedChunks === 0}
            >
              {generating ? 'Thinking…' : 'Ask'}
            </button>
          </div>
          {errorMsg && <p className="panel-status-sub error">{errorMsg}</p>}
        </section>
      </div>
    </div>
  )
}
