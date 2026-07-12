import { mat4, vec3 } from 'gl-matrix'

/**
 * A minimal orbit (arcball-ish) camera. Framework-agnostic: it owns spherical
 * state around a target and produces a view-projection matrix. Attach the
 * pointer/wheel handlers to any element; call `detach` to clean up.
 */
export class OrbitCamera {
  azimuth = 0.6 // radians, around Y
  elevation = 0.35 // radians, from the horizontal plane
  distance = 6
  target = vec3.fromValues(0, 0, 0)

  fovY = (50 * Math.PI) / 180
  near = 0.05
  far = 100

  minDistance = 0.5
  maxDistance = 40

  private readonly view = mat4.create()
  private readonly proj = mat4.create()
  private readonly viewProj = mat4.create()
  private readonly eye = vec3.create()

  /** Recompute and return the view-projection matrix as a Float32Array(16). */
  viewProjection(aspect: number): Float32Array {
    const ce = Math.cos(this.elevation)
    this.eye[0] = this.target[0] + this.distance * ce * Math.sin(this.azimuth)
    this.eye[1] = this.target[1] + this.distance * Math.sin(this.elevation)
    this.eye[2] = this.target[2] + this.distance * ce * Math.cos(this.azimuth)

    mat4.lookAt(this.view, this.eye, this.target, [0, 1, 0])
    mat4.perspective(this.proj, this.fovY, Math.max(aspect, 0.001), this.near, this.far)
    mat4.multiply(this.viewProj, this.proj, this.view)
    return this.viewProj as Float32Array
  }

  private clampElevation() {
    const limit = Math.PI / 2 - 0.02
    this.elevation = Math.max(-limit, Math.min(limit, this.elevation))
  }

  /** Wire drag-to-orbit and wheel-to-zoom onto an element. */
  attach(el: HTMLElement): () => void {
    let dragging = false
    let lastX = 0
    let lastY = 0

    const onDown = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      el.setPointerCapture(e.pointerId)
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      this.azimuth -= dx * 0.005
      this.elevation += dy * 0.005
      this.clampElevation()
    }
    const onUp = (e: PointerEvent) => {
      dragging = false
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = Math.exp(e.deltaY * 0.001)
      this.distance = Math.max(
        this.minDistance,
        Math.min(this.maxDistance, this.distance * factor),
      )
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }
}
