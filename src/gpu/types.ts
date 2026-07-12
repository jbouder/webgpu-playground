import type React from 'react'

/**
 * Everything a demo needs to talk to the GPU. Built once by the host and
 * handed to `Demo.init`. Framework-agnostic on purpose — nothing here is React.
 */
export interface DemoContext {
  device: GPUDevice
  context: GPUCanvasContext
  /** navigator.gpu.getPreferredCanvasFormat() */
  format: GPUTextureFormat
  canvas: HTMLCanvasElement
}

/**
 * A live, running demo. The host drives it: `frame` every RAF tick, `resize`
 * when the canvas changes size, `dispose` when swapping demos or tearing down.
 */
export interface DemoInstance {
  /** Called each animation frame. dt/elapsed are in seconds. */
  frame(dt: number, elapsed: number): void
  /** Canvas backing-store size changed (already in device pixels). */
  resize?(width: number, height: number, dpr: number): void
  /** Free GPU resources, workers, and event listeners. Must be idempotent. */
  dispose(): void
}

/**
 * A demo module exports a pure, React-free `init`. Its optional Controls
 * component lives in a sibling .tsx file and is wired up only here in the
 * registry — keeping the GPU module importable without React.
 *
 * Canvas demos provide `init` (+ optional `Controls`) and run under CanvasHost.
 * DOM-primary demos (e.g. inference, where WebGPU is only the compute backend
 * inside a worker) instead provide a `Panel` that takes over the main area and
 * needs no canvas or render loop.
 */
export interface Demo {
  id: string
  title: string
  description: string
  init?(ctx: DemoContext): Promise<DemoInstance>
  Controls?: React.FC<{ instance: DemoInstance }>
  /** Full main-area component for canvas-less demos. */
  Panel?: React.FC
}
