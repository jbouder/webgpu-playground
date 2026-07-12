/**
 * Typed message protocol for the WebLLM generation worker. Mirrors the
 * embedding worker's shape (numeric `id` echoed on responses) but generation
 * streams: one request yields many `token` responses followed by a single
 * `done`. `progress` messages stream against a load request's id.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type LlmRequest =
  | { id: number; type: 'load'; model: string }
  | { id: number; type: 'generate'; messages: ChatMessage[] }
  | { id: number; type: 'interrupt' }

export type LlmResponse =
  | { id: number; type: 'loaded'; model: string }
  // progress is 0..1, or -1 when indeterminate.
  | { id: number; type: 'progress'; message: string; progress: number }
  // one streamed delta of generated text.
  | { id: number; type: 'token'; text: string }
  // generation finished; `text` is the full answer, `stats` an optional
  // human-readable perf line (tok/s).
  | { id: number; type: 'done'; text: string; stats: string }
  | { id: number; type: 'error'; message: string }
