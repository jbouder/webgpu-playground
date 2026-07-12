# WebGPU Playground

A standalone **Vite + React + TypeScript** playground for experimenting with
WebGPU. A single-page app that hosts multiple self-contained WebGPU demos behind
a switcher.

**Design principle:** each demo's GPU code is a plain, framework-agnostic TS
module under `src/demos/*/`. React is a thin shell (switcher, control panels,
file upload) and never appears inside the GPU modules — so the useful demos can
be lifted into another app with no rewrite.

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
- **`src/host/Switcher.tsx`** — dropdown reading the registry.
- **`src/demos/*/`** — each demo. GPU code is React-free; WGSL is imported with
  Vite's `?raw` suffix (`import shader from './shader.wgsl?raw'`) so editing a
  shader hot-reloads.

### Adding a demo

1. Create `src/demos/<id>/index.ts` exporting a `Demo` whose `init` returns a
   `DemoInstance` (`frame` / optional `resize` / `dispose`).
2. (Optional) add a sibling `Controls.tsx` and set `Controls` on the `Demo`.
3. Register it in `src/gpu/registry.ts`.

## Cross-origin isolation (COOP/COEP) — required

The inference libraries used in later phases (transformers.js, WebLLM) need
`SharedArrayBuffer`, which requires the page to be **cross-origin isolated**.
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
3. **Inference runs in Web Workers** (Phases 4/5/7) so the render loop never
   stutters.
4. **COOP/COEP headers required** (above).
5. **Unhappy paths handled:** no-WebGPU browsers, `GPUDevice` loss, and canvas
   resize with `devicePixelRatio`.

## Build phases

- [x] **Phase 0 — Scaffold**: core abstractions, `CanvasHost` (RAF + resize +
      device-loss UI), COOP/COEP.
- [x] **Phase 1 — Animated fullscreen shader** (`shader-fullscreen`).
- [x] **Phase 2 — 3D point cloud** (`point-cloud`).
- [x] **Phase 3 — Fluid scroll background** (`fluid-scroll`).
- [x] **Phase 4 — Client-side semantic search** (`semantic-search`).
- [ ] Phase 5 — RAG with browser LLM
- [ ] Phase 6 — Music-reactive visuals
- [ ] Phase 7 — LLM trivia game

The animated shader and the fluid background are exposed through a combined
**Shader + Fluid** (`shader-fluid`) demo that composites the plasma shader
(background layer) with the reaction-diffusion fluid (alpha-blended overlay),
each independently toggleable (fluid off by default). The standalone
`shader-fullscreen` and `fluid-scroll` modules remain and are reused by it. The
**3D Point Cloud** is its own demo (with a 1k–1M point-count slider).

Demo kinds:
- **Canvas demos** provide a React-free `init(ctx)` and run under `CanvasHost`
  with an optional `Controls` side panel.
- **DOM/inference demos** (semantic search) provide a `Panel` that takes over
  the main area — WebGPU is the compute backend inside a Web Worker, so there's
  no canvas or render loop.

## Tech notes

- `@webgpu/types` provides the WebGPU TS types (added to `tsconfig.app.json`
  `types`).
- Backing-store DPR is capped at 2 in `CanvasHost` to avoid huge render targets
  on HiDPI displays.
- The inference libs are marked `optimizeDeps.exclude` in `vite.config.ts` so
  Vite serves their workers/wasm as-is.
