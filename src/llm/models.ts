/**
 * The models the demo offers. IDs must match WebLLM's prebuilt app config.
 * `contextTokens` is the model's configured context window — used only to drive
 * the context-fill gauge, so an approximate nominal value is fine.
 */
export interface ModelOption {
  id: string
  label: string
  size: string
  contextTokens: number
}

export const MODELS: ModelOption[] = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', label: 'Qwen2.5 1.5B', size: '~1.6 GB', contextTokens: 4096 },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', label: 'Llama 3.2 3B', size: '~2.3 GB', contextTokens: 4096 },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', label: 'Phi-3.5 mini', size: '~2.4 GB', contextTokens: 4096 },
]

export const DEFAULT_MODEL = MODELS[0].id

export function getModel(id: string): ModelOption {
  return MODELS.find((m) => m.id === id) ?? MODELS[0]
}
