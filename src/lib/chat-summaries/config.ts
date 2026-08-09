import { CHAT_CONTEXT_WINDOW } from '@/lib/chat-context-window'
import { LLM_OUTPUT_LIMITS } from '@/lib/llm/output-limits'

// Core configuration constants
export const CONTEXT_WINDOW = CHAT_CONTEXT_WINDOW
export const CHUNK_SIZE = 10
export const SUMMARY_GROUP_SIZE = 10
export const META_SUMMARY_CONTEXT_ROLLOVER_MESSAGES = CHUNK_SIZE * SUMMARY_GROUP_SIZE
export const SUPER_SUMMARY_GROUP_SIZE = 4

// Summary levels
export const SUMMARY_LEVEL_CHUNK = 0
export const SUMMARY_LEVEL_META = 1
export const SUMMARY_LEVEL_SUPER_META = 2

// Token estimation
export const TOKEN_ESTIMATE_DIVISOR = 3

// Shared utility-call ceiling leaves room for reasoning without allowing runaway output.
export const CHUNK_SUMMARY_MAX_TOKENS = LLM_OUTPUT_LIMITS.utility
export const META_SUMMARY_MAX_TOKENS = LLM_OUTPUT_LIMITS.utility

// CRITICAL: DO NOT USE A LOWER VALUE FOR LLM CALLS.
// Gemini 2.5 Pro reserves ~1000-2000 tokens for internal 'thinking'
// BEFORE generating output. Setting to 1024 will cause a SILENT FAILURE.
// Use this constant for utility generateText calls in this module.
// Sampling parameters are intentionally omitted to avoid provider-specific incompatibilities.
export const DEFAULT_LLM_CONFIG = {
  maxOutputTokens: CHUNK_SUMMARY_MAX_TOKENS,
} as const

// Text limits and observability thresholds
// Chunk summarization and fact extraction receive complete source messages. This is a warning
// threshold only, so unusually large chunks are visible operationally without silently losing text.
export const CHUNK_TRANSCRIPT_WARNING_CHAR_THRESHOLD = 48_000
export const META_SUMMARY_SEGMENT_CHAR_LIMIT = 1200
export const FALLBACK_SUMMARY_CHAR_LIMIT = 700
export const FALLBACK_RECENT_MESSAGES = 5

// RAG configuration
export const RAG_TOP_K = 5
export const RAG_QUERY_MESSAGES = 3
export const RAG_SIMILARITY_THRESHOLD = 0.6

// Default prompts
export const DEFAULT_CHUNK_SUMMARY_PROMPT = `Summarize the following conversation in the primary language of the conversation in one paragraph (100-150 words). Do not use JSON, Markdown, or code blocks; answer in plain text only. Always end the paragraph with a complete sentence and a final period.

Example: A user finds a character on a rainy street and brings them home. The character expressionlessly reacts with "It's bothersome" but follows. After a shower, they react positively to warm water and sit in a corner of the living room, drained. The first meeting transitions into a temporary guardianship, maintaining an efficiency-focused mindset.

Follow this style and write concisely.`

export const DEFAULT_META_SUMMARY_PROMPT =
  'You are compiling a higher-level recap from multiple chat summaries. Synthesize the main themes, decisions, and outstanding items. Preserve important names, numbers, and commitments without duplicating detail.'

export const DEFAULT_FACT_EXTRACTION_PROMPT = `Extract specific facts from the following conversation that are worth referencing later, in the primary language of the conversation. Write each fact as a single bullet point line. Exclude generic conversational content.

Extract these types of facts:
- First-time events (first meeting, first experience, etc.)
- Specific places, dates, times, food, etc.
- Personal preferences, habits, characteristics
- Important promises or decisions
- Emotionally significant moments

Output format (plain text only, no JSON or Markdown):
- Nov 10, 2025, First met at 'Meco Diner' while eating tteokbokki
- User mentioned they enjoy spicy food
- Character is afraid of cats

If there are no significant facts to record, respond with only "No significant facts to record".`

// Aggregated config export for backwards compatibility
export const SUMMARY_CONFIG = {
  CONTEXT_WINDOW,
  CHUNK_SIZE,
  SUMMARY_GROUP_SIZE,
  META_SUMMARY_CONTEXT_ROLLOVER_MESSAGES,
  SUPER_SUMMARY_GROUP_SIZE,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
} as const
