/**
 * Chat Summaries Module
 *
 * This module handles semantic memory (summaries) and episodic memory (facts)
 * for chat conversations. It provides:
 *
 * - Chunk summaries: Summaries of 10-message chunks
 * - Meta summaries: Higher-level summaries combining 10 chunk summaries
 * - Super meta summaries: Even higher-level (currently disabled)
 * - Fact extraction: Episodic memory with RAG support
 * - Context building: Assembling summaries/facts for chat generation
 */

import type { UpdateSummariesOptions } from './types'
import { CHUNK_SIZE } from './config'
import { getMessageCount } from './db-helpers'
import { updateCanonicalSealedMemoryArtifacts } from './sealed-memory-writer'

// Re-export types
export type {
  ChatSummariesSupabaseClient,
  SanitizedMessage,
  BuildContextOptions,
  BuildContextResult,
  UpdateSummariesOptions,
  RegenerateConfig,
  SummaryRange,
} from './types'

// Re-export config
export {
  SUMMARY_CONFIG,
  DEFAULT_CHUNK_SUMMARY_PROMPT,
  DEFAULT_META_SUMMARY_PROMPT,
  DEFAULT_FACT_EXTRACTION_PROMPT,
  DEFAULT_LLM_CONFIG,
} from './config'

// Re-export formatters
export {
  formatSummarySegments,
  formatFacts,
  calculateChunkBoundaries,
  areChunksSequential,
} from './formatters'

// Re-export context builder
export { buildContext } from './context-builder'

/**
 * Update summaries and facts for a chat
 *
 * This is the main entry point for summary generation. It:
 * 1. Processes any regeneration requests
 * 2. Creates new chunk summaries for unprocessed messages
 * 3. Creates meta summaries when enough chunks exist
 * 4. (Disabled) Creates super meta summaries
 */
export async function updateSummaries({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  regenerate,
}: UpdateSummariesOptions): Promise<void> {
  const totalMessages = await getMessageCount(supabase, chatId)

  if (totalMessages === null) {
    throw new Error(`Failed to determine projected conversation size for summary update: ${chatId}`)
  }

  if (totalMessages < CHUNK_SIZE * 2) {
    return
  }

  await updateCanonicalSealedMemoryArtifacts({
    supabase,
    chatId,
    userId,
    model,
    provider,
    modelName,
    regenerate,
    sealedThroughSeq: totalMessages - CHUNK_SIZE,
  })
}
