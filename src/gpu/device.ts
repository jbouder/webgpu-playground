/**
 * Singleton adapter/device initialization.
 *
 * The device is expensive and process-global, so we cache the promise. On
 * device loss we clear the cache so the next `getDevice()` re-initializes.
 * The host component owns loss *recovery* (it holds the device and awaits
 * `device.lost`); this module just makes re-init possible.
 */

let devicePromise: Promise<GPUDevice> | null = null

export class WebGPUUnsupportedError extends Error {
  constructor(message = 'WebGPU is not supported in this browser.') {
    super(message)
    this.name = 'WebGPUUnsupportedError'
  }
}

export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.gpu
}

export function getDevice(): Promise<GPUDevice> {
  if (!isWebGPUSupported()) {
    return Promise.reject(new WebGPUUnsupportedError())
  }
  if (!devicePromise) {
    devicePromise = (async () => {
      const adapter = await navigator.gpu.requestAdapter()
      if (!adapter) {
        throw new WebGPUUnsupportedError(
          'No suitable GPUAdapter found (WebGPU may be disabled).',
        )
      }
      const device = await adapter.requestDevice({ label: 'playground-device' })

      // Clear the cache on loss so a later getDevice() re-inits from scratch.
      device.lost.then(() => {
        if (devicePromise) devicePromise = null
      })

      return device
    })()

    // If init itself fails, don't cache the rejection — allow a retry.
    devicePromise.catch(() => {
      devicePromise = null
    })
  }
  return devicePromise
}
