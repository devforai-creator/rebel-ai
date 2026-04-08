import type { ChatSummary, Message } from '@/types/database.types'
import type { createClient as createServerClient } from '@/lib/supabase/server'
import type { LanguageModel } from 'ai'

// Supabase client type
export type ServerSupabaseClient = Awaited<ReturnType<typeof createServerClient>>
export type ChatSummariesSupabaseClient = ServerSupabaseClient

// Chat role types
export type ChatRole = 'user' | 'assistant'

// Summary row types for database queries
export type SummaryRow = Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>
export type ChunkSummaryRow = Pick<ChatSummary, 'id' | 'start_seq' | 'end_seq' | 'summary'>
export type MessageTranscriptRow = Pick<Message, 'role' | 'content'>

// Public interface for sanitized messages
export interface SanitizedMessage {
  role: ChatRole
  content: string
  messageId?: string | null
}

// Range type for summary boundaries
export interface SummaryRange {
  startSeq: number
  endSeq: number
}

// Regeneration configuration
export interface RegenerateConfig {
  chunkRanges?: SummaryRange[]
  factRanges?: SummaryRange[]
  metaRanges?: SummaryRange[]
  regenerateAll?: boolean // Not yet implemented
}

// Build context options and result
export interface BuildContextOptions {
  supabase: ServerSupabaseClient
  chatId: string
  sanitizedMessages: SanitizedMessage[]
  baseSystemPrompt: string
  /** Optional dynamic context blocks appended after the static prompt (e.g., lorebook). */
  extraDynamicContext?: string[]
}

// RAG result info for debug_info
export interface RagResultInfo {
  enabled: boolean
  threshold: number
  topK: number
  results: Array<{
    seq: string
    similarity: number
    preview: string
  }>
}

export interface BuildContextResult {
  systemPrompt: string
  /** Dynamic context (summaries, facts, extra blocks) - separated for Anthropic caching optimization */
  dynamicContext: string | null
  recentMessages: SanitizedMessage[]
  ragInfo?: RagResultInfo
}

// Update summaries options
export interface UpdateSummariesOptions {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  regenerate?: RegenerateConfig
}

// Chunk processing options
export interface ProcessChunkOptions {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  totalMessages: number
  previousEnd: number
  chunkPrompt: string
  factPrompt: string
}

// Meta processing options
export interface ProcessMetaOptions {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  metaPrompt: string
}

// Create chunk summary options
export interface CreateChunkSummaryOptions {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  startSeq: number
  endSeq: number
  systemPrompt: string
  expectedMessageCount?: number | null
  transcriptMessages?: MessageTranscriptRow[]
}

// Create chunk facts options
export interface CreateChunkFactsOptions {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  startSeq: number
  endSeq: number
  factPrompt: string
  transcriptMessages?: MessageTranscriptRow[]
}

// Higher level summary options
export interface CreateHigherLevelSummaryOptions {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  segments: Array<Pick<ChatSummary, 'start_seq' | 'end_seq' | 'summary'>>
  startSeq: number
  endSeq: number
  systemPrompt: string
  targetLevel: number
  fallbackLabel: string
}

// Regeneration options
export interface RegenerationProcessOptions {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  chunkPrompt: string
  metaPrompt: string
  factPrompt: string
  regenerate: RegenerateConfig
  chunkSize?: number
}

// Summary generation with fallback
export interface SummaryWithFallbackOptions {
  model: LanguageModel
  provider: string
  systemPrompt: string
  prompt: string
  maxTokens: number
  fallbackLabel: string
  fallbackTextFactory: () => string
  promptCache?: import('@/lib/llm/prompt-cache').PromptCacheDecision | null
}

export interface SummaryWithFallbackResult {
  summaryText: string
  tokenCount: number | null
  finishReason?: string
}

// RAG search options
export interface SearchRelevantFactsOptions {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  recentMessages: SanitizedMessage[]
  topK?: number
}

// Fact row type (similarity is optional - only present when returned from RAG search)
export interface FactRow {
  start_seq: number
  end_seq: number
  facts: string
  similarity?: number
}
