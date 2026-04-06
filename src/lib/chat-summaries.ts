/**
 * Chat Summaries - Re-export from modular implementation
 *
 * This file maintains backwards compatibility with existing imports.
 * The actual implementation is now split across:
 * - chat-summaries/config.ts - Constants and prompts
 * - chat-summaries/types.ts - Type definitions
 * - chat-summaries/formatters.ts - Formatting utilities
 * - chat-summaries/db-helpers.ts - Database query helpers
 * - chat-summaries/context-builder.ts - Context building for chat
 * - chat-summaries/chunk-summarizer.ts - Chunk summary generation
 * - chat-summaries/meta-summarizer.ts - Meta summary generation
 * - chat-summaries/regeneration.ts - Summary regeneration
 * - chat-summaries/index.ts - Main orchestration
 */

// Re-export everything from the modular implementation
export {
  // Types
  type ChatSummariesSupabaseClient,
  type SanitizedMessage,
  type BuildContextOptions,
  type BuildContextResult,
  type UpdateSummariesOptions,
  type RegenerateConfig,
  type SummaryRange,

  // Config
  SUMMARY_CONFIG,
  DEFAULT_CHUNK_SUMMARY_PROMPT,
  DEFAULT_META_SUMMARY_PROMPT,
  DEFAULT_FACT_EXTRACTION_PROMPT,
  DEFAULT_LLM_CONFIG,

  // Formatters
  formatSummarySegments,
  formatFacts,
  calculateChunkBoundaries,
  areChunksSequential,

  // Context builder
  buildContext,

  // Main function
  updateSummaries,
} from './chat-summaries/index'
