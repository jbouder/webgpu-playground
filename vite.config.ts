import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// COOP/COEP enable cross-origin isolation, which unlocks SharedArrayBuffer —
// transformers.js and WebLLM (Phases 4/5/7) rely on it, and without these
// headers model loading fails in confusing ways.
//
// COEP is `credentialless` (not `require-corp`) so cross-origin model files
// from the Hugging Face CDN load without needing a CORP header on their
// responses, while still keeping the page cross-origin isolated. (Chromium/
// Firefox support credentialless; if you self-host models that send
// `Cross-Origin-Resource-Policy: cross-origin`, `require-corp` also works.)
//
// Production hosts MUST send the same two headers on the document response
// (see README for Netlify/Vercel/nginx snippets).
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: crossOriginIsolation,
  },
  preview: {
    headers: crossOriginIsolation,
  },
  // The inference libs are large and ship their own workers/wasm — let Vite
  // serve them as-is instead of pre-bundling. (Harmless until those phases;
  // wired up now so the config is stable.)
  optimizeDeps: {
    exclude: ['@huggingface/transformers', '@mlc-ai/web-llm'],
  },
  // ?raw imports (WGSL) are handled by Vite out of the box.
})
