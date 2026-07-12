import { useCallback, useEffect, useRef, useState } from 'react'
import { getDevice, WebGPUUnsupportedError } from '../gpu/device'
import type { Demo, DemoInstance } from '../gpu/types'

type Status = 'init' | 'ready' | 'unsupported' | 'lost' | 'error'

interface CanvasHostProps {
  demo: Demo
  /** Receives the live instance when a demo starts, and null when it stops. */
  onInstance?: (instance: DemoInstance | null) => void
}

// Cap the backing-store DPR so retina/HiDPI displays don't allocate absurdly
// large render targets. 2 is plenty crisp.
const MAX_DPR = 2

export function CanvasHost({ demo, onInstance }: CanvasHostProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<Status>('init')
  const [message, setMessage] = useState('')
  // Bumping this re-runs the init effect (used for device-loss recovery).
  const [generation, setGeneration] = useState(0)

  // Keep the callback in a ref so it isn't an effect dependency (parents can
  // pass an inline function without forcing a full GPU re-init).
  const onInstanceRef = useRef(onInstance)
  onInstanceRef.current = onInstance

  const retry = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return
    // Pin a non-null binding so control-flow narrowing survives into the
    // nested closures below (TS doesn't carry the guard into inner functions).
    const canvas: HTMLCanvasElement = canvasEl

    let cancelled = false
    let instance: DemoInstance | null = null
    let raf = 0
    let resizeObserver: ResizeObserver | null = null

    const notifyInstance = (i: DemoInstance | null) => onInstanceRef.current?.(i)

    const applySize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr))
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
        instance?.resize?.(w, h, dpr)
      }
    }

    async function run() {
      setStatus('init')
      setMessage('')

      let device: GPUDevice
      try {
        device = await getDevice()
      } catch (err) {
        if (cancelled) return
        if (err instanceof WebGPUUnsupportedError) {
          setStatus('unsupported')
          setMessage(err.message)
        } else {
          setStatus('error')
          setMessage(err instanceof Error ? err.message : String(err))
        }
        return
      }
      if (cancelled) return

      // Surface device loss to the UI. 'destroyed' means an intentional
      // teardown by us, which we never trigger on the singleton, so any loss
      // here is genuine and worth recovering from.
      device.lost.then((info) => {
        if (cancelled || info.reason === 'destroyed') return
        setStatus('lost')
        setMessage(info.message || 'The GPU device was lost.')
      })

      const context = canvas.getContext('webgpu')
      if (!context) {
        if (!cancelled) {
          setStatus('unsupported')
          setMessage('Could not acquire a WebGPU canvas context.')
        }
        return
      }
      const format = navigator.gpu.getPreferredCanvasFormat()
      context.configure({ device, format, alphaMode: 'opaque' })

      if (!demo.init) {
        if (!cancelled) {
          setStatus('error')
          setMessage(`Demo "${demo.id}" has no init() — it should be a Panel demo.`)
        }
        return
      }

      try {
        instance = await demo.init({ device, context, format, canvas })
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setMessage(err instanceof Error ? err.message : String(err))
        return
      }
      if (cancelled) {
        instance.dispose()
        instance = null
        return
      }

      notifyInstance(instance)
      applySize()

      resizeObserver = new ResizeObserver(applySize)
      resizeObserver.observe(canvas)
      // The observer catches CSS-size changes; a window resize also covers a
      // pure devicePixelRatio change (e.g. dragging to a denser monitor).
      window.addEventListener('resize', applySize)

      setStatus('ready')

      // Single RAF loop for the active instance.
      let start = 0
      let last = 0
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop)
        if (!start) {
          start = now
          last = now
        }
        const dt = (now - last) / 1000
        const elapsed = (now - start) / 1000
        last = now
        try {
          instance?.frame(dt, elapsed)
        } catch (err) {
          cancelAnimationFrame(raf)
          setStatus('error')
          setMessage(err instanceof Error ? err.message : String(err))
        }
      }
      raf = requestAnimationFrame(loop)
    }

    run()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      window.removeEventListener('resize', applySize)
      notifyInstance(null)
      instance?.dispose()
      // The device is a shared singleton — deliberately not destroyed here.
    }
  }, [demo, generation])

  return (
    <div className="canvas-host">
      <canvas ref={canvasRef} className="gpu-canvas" />
      {status !== 'ready' && (
        <div className="canvas-overlay">
          <StatusPanel status={status} message={message} onRetry={retry} />
        </div>
      )}
    </div>
  )
}

function StatusPanel({
  status,
  message,
  onRetry,
}: {
  status: Status
  message: string
  onRetry: () => void
}) {
  if (status === 'init') {
    return <p className="status status-info">Initializing WebGPU…</p>
  }
  if (status === 'unsupported') {
    return (
      <div className="status status-warn">
        <h2>WebGPU not available</h2>
        <p>{message}</p>
        <p className="status-hint">
          Try a recent Chrome, Edge, or Safari — and check that hardware
          acceleration is enabled.
        </p>
      </div>
    )
  }
  if (status === 'lost') {
    return (
      <div className="status status-warn">
        <h2>GPU device lost</h2>
        <p>{message}</p>
        <button type="button" onClick={onRetry}>
          Reinitialize
        </button>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="status status-error">
        <h2>Something went wrong</h2>
        <p>{message}</p>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    )
  }
  return null
}
