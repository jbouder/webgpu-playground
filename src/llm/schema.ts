/**
 * The constrained-output contract. When "structured output" is on, generation
 * is constrained (via WebLLM/XGrammar `response_format: json_object` + schema)
 * to exactly this shape, so parsing is deterministic — no regexing prose. The
 * same schema string is sent to the model; the same TS type describes what
 * comes back.
 */
export const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    severity: { type: 'string', enum: ['info', 'warning', 'error', 'critical'] },
    category: { type: 'string', enum: ['network', 'runtime', 'performance', 'security', 'unknown'] },
    summary: { type: 'string', maxLength: 280 },
    pattern: { type: 'string', description: "named pattern, e.g. 'CORS preflight failure'" },
    affectedCount: { type: 'integer' },
    suggestedAction: { type: 'string', description: 'advisory only, for a human to read' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
  },
  required: ['severity', 'category', 'summary'],
} as const

export type Severity = 'info' | 'warning' | 'error' | 'critical'
export type Category = 'network' | 'runtime' | 'performance' | 'security' | 'unknown'
export type Confidence = 'low' | 'medium' | 'high'

export interface AnalysisResult {
  severity: Severity
  category: Category
  summary: string
  pattern?: string
  affectedCount?: number
  suggestedAction?: string
  confidence?: Confidence
}

/** The schema string handed to the runtime's response_format. */
export const ANALYSIS_SCHEMA_STRING = JSON.stringify(ANALYSIS_SCHEMA)

/** Parse a model response into AnalysisResult, tolerating markdown fences and
 *  stray prose around the JSON. Returns null if nothing parseable is found. */
export function parseAnalysis(text: string): AnalysisResult | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1))
    if (typeof obj.severity === 'string' && typeof obj.category === 'string' && typeof obj.summary === 'string') {
      return obj as AnalysisResult
    }
    return null
  } catch {
    return null
  }
}
