import { useEffect, useReducer, useState } from 'react'
import type { DemoInstance } from '../../gpu/types'
import type { SoundMixerInstance } from './index'

export function SoundMixerControls({ instance }: { instance: DemoInstance }) {
  // The demo module owns the concrete type; the registry only knows DemoInstance.
  const inst = instance as SoundMixerInstance
  const { mixer } = inst

  // The mixer is the source of truth; force a re-render when it changes.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [sensitivity, setSensitivity] = useState(inst.params.sensitivity)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    mixer.onChange = () => bump()
    return () => {
      mixer.onChange = null
    }
  }, [mixer])

  const tracks = mixer.trackList
  const anySolo = tracks.some((t) => t.soloed)

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-upload of the same file
    if (!file) return
    setLoading(true)
    setLoadError('')
    try {
      await mixer.addTrackFromFile(file)
    } catch {
      setLoadError('Could not decode that audio file.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="controls mixer-controls">
      <h2 className="controls-title">Sound Mixer</h2>

      {/* Transport + master */}
      <div className="control-group">
        <button
          type="button"
          className={`transport ${mixer.playing ? 'is-playing' : ''}`}
          onClick={() => mixer.toggleTransport()}
        >
          {mixer.playing ? '■ Stop' : '▶ Play'}
        </button>
        <label className="control-row">
          <span>Master</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={mixer.masterVolume}
            onChange={(e) => mixer.setMasterVolume(Number(e.target.value))}
          />
          <span className="control-value">{Math.round(mixer.masterVolume * 100)}</span>
        </label>
      </div>

      {/* Track strips */}
      <div className="control-group">
        <span className="group-label">Tracks</span>
        <div className="mixer-strips">
          {tracks.map((t) => {
            const dimmed = anySolo && !t.soloed
            return (
              <div key={t.id} className={`strip ${dimmed ? 'is-dimmed' : ''}`}>
                <div className="strip-head">
                  <span className="strip-name" title={t.name}>
                    {t.name}
                  </span>
                  {t.removable && (
                    <button
                      type="button"
                      className="strip-x"
                      title="Remove track"
                      onClick={() => mixer.removeTrack(t.id)}
                    >
                      ×
                    </button>
                  )}
                </div>

                <label className="control-row">
                  <span>Vol</span>
                  <input
                    type="range"
                    min={0}
                    max={1.5}
                    step={0.01}
                    value={t.gain}
                    onChange={(e) => mixer.setGain(t.id, Number(e.target.value))}
                  />
                  <span className="control-value">{Math.round(t.gain * 100)}</span>
                </label>

                <label className="control-row">
                  <span>Pan</span>
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.01}
                    value={t.pan}
                    onChange={(e) => mixer.setPan(t.id, Number(e.target.value))}
                  />
                  <span className="control-value">
                    {t.pan === 0 ? 'C' : `${t.pan < 0 ? 'L' : 'R'}${Math.round(Math.abs(t.pan) * 100)}`}
                  </span>
                </label>

                <div className="strip-btns">
                  <button
                    type="button"
                    className={`mini ${t.muted ? 'mute-on' : ''}`}
                    onClick={() => mixer.toggleMute(t.id)}
                  >
                    Mute
                  </button>
                  <button
                    type="button"
                    className={`mini ${t.soloed ? 'solo-on' : ''}`}
                    onClick={() => mixer.toggleSolo(t.id)}
                  >
                    Solo
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        <label className="file-btn mixer-add">
          {loading ? 'Decoding…' : '+ Add audio track'}
          <input type="file" accept="audio/*" hidden onChange={onFile} disabled={loading} />
        </label>
        {loadError && <p className="panel-status-sub error">{loadError}</p>}
      </div>

      {/* Visualizer */}
      <div className="control-group">
        <span className="group-label">Visualizer</span>
        <label className="control-row">
          <span>Sensitivity</span>
          <input
            type="range"
            min={0.4}
            max={3}
            step={0.05}
            value={sensitivity}
            onChange={(e) => {
              const v = Number(e.target.value)
              inst.params.sensitivity = v
              setSensitivity(v)
            }}
          />
          <span className="control-value">{sensitivity.toFixed(1)}×</span>
        </label>
      </div>

      <p className="controls-hint">
        Built-in loops are synthesized in the browser and play in sync. Solo isolates tracks;
        drop in your own audio to mix against them.
      </p>
    </div>
  )
}
