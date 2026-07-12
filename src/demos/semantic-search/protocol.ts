/**
 * Typed message protocol for the embedding worker. Every request carries a
 * numeric `id`; the matching response echoes it so the host can resolve the
 * right pending promise. `progress` messages stream against a load request's
 * id without resolving it.
 */

export type WorkerRequest =
  | { id: number; type: 'load'; model: string }
  | { id: number; type: 'embed'; texts: string[] }

export type WorkerResponse =
  | { id: number; type: 'loaded'; dims: number; backend: string }
  // progress is 0..1, or -1 when indeterminate.
  | { id: number; type: 'progress'; message: string; progress: number }
  | { id: number; type: 'embeddings'; vectors: number[][] }
  | { id: number; type: 'error'; message: string }
