# WebGPU Playground

A standalone **Vite + React + TypeScript** playground for experimenting with
WebGPU. A single-page app that hosts multiple self-contained WebGPU demos behind
a switcher.

**Design principle:** each demo's GPU code is a plain, framework-agnostic TS
module under `src/demos/*/`. React is a thin shell (switcher, control panels,
file upload) and never appears inside the GPU modules — so the useful demos (the
point cloud and the crossfilter engine especially) can be lifted into another
app with no rewrite.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b && vite build
npm run preview  # serve the production build (with COOP/COEP)
npm run lint     # oxlint
```

Open in a browser with WebGPU: recent **Chrome / Edge** (or **Safari 18+**),
with hardware acceleration enabled. Browsers without WebGPU get a graceful
"not supported" message instead of a blank screen.

## Architecture

- **`src/gpu/types.ts`** — the core contracts: `Demo`, `DemoInstance`,
  `DemoContext`. A demo exports a pure `init(ctx)`; its optional React
  `Controls` component lives in a sibling `.tsx` and is wired up only in the
  registry.
- **`src/gpu/device.ts`** — singleton adapter/device init. Clears its cache on
  device loss so re-init is possible.
- **`src/gpu/registry.ts`** — the array of all demos (switcher order).
- **`src/host/CanvasHost.tsx`** — owns the canvas ref, the single
  `requestAnimationFrame` loop, a `ResizeObserver` applying `devicePixelRatio`,
  and device-loss / unsupported UI. Swapping demos = `dispose()` old, `init()`
  new (driven by a React `key`).
- **`src/host/Sidebar.tsx`** — navigation list reading the registry.
- **`src/demos/*/`** — each demo. GPU code is React-free; WGSL is imported with
  Vite's `?raw` suffix (`import shader from './shader.wgsl?raw'`) so editing a
  shader hot-reloads.
- **`src/lib/`** — framework-agnostic helpers reused across demos: `chunk.ts` +
  `vector-store.ts` (retrieval), `scales.ts` (CPU-side linear scales/ticks for
  axes and hit-testing), `gpu-image.ts` (`ImagePipeline` — ping-pong
  rgba16float compute filter chain — and `ImageBlitter`, shared by still-image
  and live-camera sources).

### Adding a demo

1. Create `src/demos/<id>/index.ts` exporting a `Demo` whose `init` returns a
   `DemoInstance` (`frame` / optional `resize` / `dispose`).
2. (Optional) add a sibling `Controls.tsx` and set `Controls` on the `Demo`.
3. Register it in `src/gpu/registry.ts`.

## Cross-origin isolation (COOP/COEP) — required

The inference libraries (transformers.js, WebLLM) need `SharedArrayBuffer`,
which requires the page to be **cross-origin isolated**.
The dev server and `vite preview` already send these headers (see
`vite.config.ts`):

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

`credentialless` (rather than `require-corp`) lets the cross-origin model files
from the Hugging Face CDN load without a CORP header on their responses, while
still keeping the page cross-origin isolated. Chromium and Firefox support it;
if you self-host models that send `Cross-Origin-Resource-Policy: cross-origin`,
`require-corp` works too (and is required for Safari, which doesn't yet support
`credentialless`).

**Your production host must send the same two headers on the document
response**, or model loading fails in confusing ways. Examples:

**Netlify** — `netlify.toml` or `public/_headers`:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: credentialless
```

**Vercel** — `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "credentialless" }
      ]
    }
  ]
}
```

**nginx**:

```
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy credentialless always;
```

## Hard constraints

1. **No SSR.** `navigator.gpu` only exists in the browser (Vite SPA, no SSR).
2. **GPU modules stay React-free.** Anything under `src/demos/*/` that touches
   the device is importable without React.
3. **Inference runs in Web Workers** (semantic-search, rag-llm) so the render
   loop never stutters.
4. **COOP/COEP headers required** (above).
5. **Unhappy paths handled:** no-WebGPU browsers, `GPUDevice` loss, and canvas
   resize with `devicePixelRatio`.

## Demos

Each is a self-contained module under `src/demos/`, chosen from the sidebar.

- **Shader + Fluid** (`shader-fluid`) — an animated plasma shader with ripple
  distortion, scanlines, and vignette, composited with a Gray-Scott
  reaction-diffusion fluid (alpha-blended overlay). Each layer is independently
  toggleable. Built from the standalone `shader-fullscreen` and `fluid-scroll`
  modules, which it reuses.
- **3D Point Cloud** (`point-cloud`) — instanced rendering of a procedural galaxy
  with an orbit camera and depth buffer, and a 1k–1M point-count slider.
- **Media Lab** (`image-lab`) — upload an image (or use the synthetic sample) or
  process a live `getUserMedia` camera feed with the same GPU compute filters:
  exposure, contrast, saturation, temperature, separable gaussian blur, unsharp,
  Sobel edges, vignette, and grayscale. Each filter is a compute pass over
  ping-pong `rgba16float` textures (one pass per step, so reads see the previous
  pass's full output). Still images only re-run when a value changes; live video
  runs in real time with optional selfie mirroring. A before/after split wipes the
  result against the original, and the feed never leaves the browser.
- **Crossfilter Dashboard** (`crossfilter`) — five linked panels (three
  histograms, a time series, a latency×cost density heatmap) over 1M–10M rows of
  synthetic LLM telemetry. Drag a range on any histogram and every other panel
  refilters instantly; brushes compound across dimensions. The dataset is
  pre-binned and packed one u32 per row (`data.ts`), uploaded once as a columnar
  buffer, and an atomic-scatter compute pass (`aggregate.wgsl`) rebuilds every
  panel's histogram on each brush change — the CPU never rescans the rows.
  `engine.ts` (React-free) owns the buffers and brush state; panels render into
  viewports of one canvas (`render.wgsl`). Interactive at 10M rows.
- **Semantic Search** (`semantic-search`) — paste a document; transformers.js
  embeds it in a Web Worker (WebGPU backend), and queries retrieve the most
  relevant chunks by cosine similarity, fully local.
- **RAG Chat** (`rag-llm`) — reuses the semantic-search retrieval and adds a
  WebLLM generation worker. A question retrieves the top passages as grounded
  context for a small instruct model (default Llama-3.2-1B, swappable); tokens
  stream back into the chat.

Two shapes of demo:
- **Canvas demos** (shader-fluid, point-cloud, image-lab, crossfilter) provide a
  React-free `init(ctx)` and run under `CanvasHost` with an
  optional `Controls` side panel.
- **DOM/inference demos** (semantic-search, rag-llm) provide a `Panel` that takes
  over the main area — WebGPU is the compute/inference backend inside Web
  Workers, so there's no canvas or render loop.

## Tech notes

- `@webgpu/types` provides the WebGPU TS types (added to `tsconfig.app.json`
  `types`).
- Backing-store DPR is capped at 2 in `CanvasHost` to avoid huge render targets
  on HiDPI displays.
- The inference libs are marked `optimizeDeps.exclude` in `vite.config.ts` so
  Vite serves their workers/wasm as-is.
