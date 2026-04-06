/**
 * RisuAI Chat Format Types
 *
 * Chat format type definitions for bidirectional compatibility with RisuAI
 * - Import: RisuAI JSON -> RebelAI
 * - Export: RebelAI -> RisuAI JSON
 */

/**
 * Generation info for RisuAI messages
 */
export interface RisuGenerationInfo {
  model: string
  generationId: string
  inputTokens: number
  outputTokens: number
  maxContext: number
}

/**
 * Individual RisuAI message
 */
export interface RisuMessage {
  role: 'user' | 'char'
  data: string
  time: number // Unix timestamp in milliseconds
  name: string | null
  chatId: string // UUID for this specific message
  saying?: string // Character/persona reference (char messages only)
  generationInfo?: RisuGenerationInfo // Generation metadata (char messages only)
  promptInfo?: Record<string, unknown> // Additional prompt info (usually empty)
}

/**
 * RebelAI summary data (for Export/Import)
 */
export interface RebelSummary {
  level: number // 0: chunk, 1: meta
  start_seq: number
  end_seq: number
  summary: string
  token_count?: number | null
  created_at?: string
}

/**
 * RebelAI episodic fact data (for Export/Import)
 * Note: embeddings are not exported (need regeneration on import)
 */
export interface RebelFact {
  start_seq: number
  end_seq: number
  facts: string
  created_at?: string
}

/**
 * RebelAI extension data (field ignored by RisuAI)
 */
export interface RebelAIExtension {
  version: string
  summaries: RebelSummary[]
  facts: RebelFact[]
}

/**
 * RisuAI chat data
 */
export interface RisuChatData {
  message: RisuMessage[]
  note: string
  name: string
  localLore: unknown[] // Local lorebook entries
  fmIndex: number
  id: string
  _rebelai?: RebelAIExtension // RebelAI-only extension (ignored by RisuAI)
}

/**
 * RisuAI chat export format
 */
export interface RisuChat {
  type: 'risuChat'
  ver: 2
  data: RisuChatData
  folders: unknown[] // Folder structure for organization
}

/**
 * RebelAI message (for Import/Export conversion)
 */
export interface RebelMessage {
  id?: string
  chat_id?: string
  sequence?: number
  role: 'user' | 'assistant' | 'system'
  content: string
  model_used?: string | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  latency_ms?: number | null
  error_code?: string | null
  debug_info?: Record<string, unknown> | null
  created_at?: string
}

/**
 * Import result
 */
export interface ChatImportResult {
  success: boolean
  chatId?: string
  messageCount?: number
  error?: string
  warnings?: string[]
}

/**
 * Export metadata
 */
export interface ChatExportMetadata {
  characterName: string
  chatTitle?: string
  exportedAt: string
  source: 'RebelAI'
}
