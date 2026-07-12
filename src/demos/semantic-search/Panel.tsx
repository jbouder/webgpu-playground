import { useEffect, useRef, useState } from 'react'
import type { SearchResult } from '../../lib/vector-store'
import { SemanticSearchEngine } from './index'

type Status = 'loading' | 'ready' | 'error'

const SAMPLE_DOC = `WebGPU is a modern graphics and compute API for the web. Unlike WebGL, which was based on OpenGL ES, WebGPU is designed around the concepts of modern native APIs like Vulkan, Metal, and Direct3D 12. It exposes explicit control over the GPU: applications create pipelines, allocate buffers and textures, and record command encoders that are submitted to a queue.

Compute shaders are a first-class feature in WebGPU. A compute pass dispatches workgroups that run in parallel across the GPU's cores, reading and writing storage buffers and storage textures. This makes WebGPU suitable not only for rendering but also for general-purpose GPU computation, such as physics simulation, image processing, and machine-learning inference.

Because the API is entirely client-side, WebGPU pairs well with in-browser machine learning. Libraries like transformers.js can run embedding models directly on the GPU, so text can be turned into vectors without any server round trip. The vectors are compared with cosine similarity to find semantically related passages.

Device loss is an important edge case. The GPU device can be lost when the browser reclaims resources, the machine sleeps, or a driver resets. Well-behaved WebGPU applications listen for the device-lost event and recreate their resources rather than crashing.`

export function SemanticSearchPanel() {
  const engineRef = useRef<SemanticSearchEngine | null>(null)

  const [status, setStatus] = useState<Status>('loading')
  const [progress, setProgress] = useState<{ message: string; value: number }>({
    message: 'Starting…',
    value: -1,
  })
  const [backend, setBackend] = useState('')
  const [dims, setDims] = useState(0)

  const [docText, setDocText] = useState('')
  const [indexedChunks, setIndexedChunks] = useState(0)
  const [indexing, setIndexing] = useState(false)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Create the engine + load the model when the panel mounts.
  useEffect(() => {
    const engine = new SemanticSearchEngine()
    engineRef.current = engine
    engine.onProgress = (p) =>
      setProgress({ message: p.message, value: p.progress })

    let cancelled = false
    engine
      .load()
      .then(({ dims: d, backend: b }) => {
        if (cancelled) return
        setDims(d)
        setBackend(b)
        setStatus('ready')
      })
      .catch((err: Error) => {
        if (cancelled) return
        setErrorMsg(err.message)
        setStatus('error')
      })

    return () => {
      cancelled = true
      engine.dispose()
      engineRef.current = null
    }
  }, [])

  const handleIndex = async () => {
    const engine = engineRef.current
    if (!engine || !docText.trim()) return
    setIndexing(true)
    setErrorMsg('')
    setResults([])
    try {
      engine.clear()
      const { chunks } = await engine.indexText(docText)
      setIndexedChunks(chunks)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setIndexing(false)
    }
  }

  const handleSearch = async () => {
    const engine = engineRef.current
    if (!engine || !query.trim() || engine.size === 0) return
    setSearching(true)
    setErrorMsg('')
    try {
      setResults(await engine.search(query, 5))
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSearching(false)
    }
  }

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setDocText(await file.text())
  }

  const pct = progress.value >= 0 ? Math.round(progress.value * 100) : null

  return (
    <div className="panel semantic">
      {status === 'loading' && (
        <div className="panel-status">
          <div className="spinner" />
          <div>
            <p className="panel-status-title">Loading embedding model…</p>
            <p className="panel-status-sub">
              {progress.message}
              {pct !== null ? ` — ${pct}%` : ''}
            </p>
            {pct !== null && (
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${pct}%` }} />
              </div>
            )}
            <p className="panel-status-note">
              First load downloads the model (~90&nbsp;MB) and caches it in the
              browser.
            </p>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div className="panel-status">
          <div>
            <p className="panel-status-title error">Failed to load model</p>
            <p className="panel-status-sub">{errorMsg}</p>
          </div>
        </div>
      )}

      {status === 'ready' && (
        <div className="semantic-grid">
          <section className="semantic-col">
            <div className="col-head">
              <h3>Document</h3>
              <span className="badge">
                {backend} · {dims}d
              </span>
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
                <input type="file" accept=".txt,.md,text/*" onChange={onFile} hidden />
              </label>
              <button
                type="button"
                className="ghost"
                onClick={() => setDocText(SAMPLE_DOC)}
              >
                Use sample
              </button>
              <button
                type="button"
                onClick={handleIndex}
                disabled={indexing || !docText.trim()}
              >
                {indexing ? 'Indexing…' : 'Index document'}
              </button>
            </div>
            {indexing && progress.value >= 0 && (
              <p className="panel-status-sub">{progress.message}</p>
            )}
            {indexedChunks > 0 && !indexing && (
              <p className="ok-note">
                Indexed {indexedChunks} chunk{indexedChunks === 1 ? '' : 's'}.
              </p>
            )}
          </section>

          <section className="semantic-col">
            <div className="col-head">
              <h3>Query</h3>
            </div>
            <div className="row">
              <input
                className="query-input"
                type="text"
                placeholder="Ask something about the document…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button
                type="button"
                onClick={handleSearch}
                disabled={searching || !query.trim() || indexedChunks === 0}
              >
                {searching ? 'Searching…' : 'Search'}
              </button>
            </div>
            {indexedChunks === 0 && (
              <p className="panel-status-sub">Index a document first.</p>
            )}
            {errorMsg && <p className="panel-status-sub error">{errorMsg}</p>}

            <ol className="results">
              {results.map((r) => (
                <li key={r.index} className="result">
                  <div className="result-bar-wrap">
                    <div
                      className="result-bar"
                      style={{ width: `${Math.max(2, Math.round(r.score * 100))}%` }}
                    />
                    <span className="result-score">{r.score.toFixed(3)}</span>
                  </div>
                  <p className="result-text">{r.text}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </div>
  )
}
