import { resolveChatMemoryConfig } from '@/lib/chat/model-config'
import { CHUNK_SIZE, SUMMARY_LEVEL_CHUNK } from '@/lib/chat-summaries/config'
import { getLastSummaryEnd, getMessageCount } from '@/lib/chat-summaries/db-helpers'
import { loadChatEpisodicMemorySettings } from '@/lib/chat-summaries/episodic-memory'
import { updateSummaries } from '@/lib/chat-summaries/index'
import { calculateChunkBoundaries } from '@/lib/chat-summaries/formatters'
import type { SummaryRange } from '@/lib/chat-summaries/types'
import {
  buildPrefixLiveBlocksMemoryPlan,
  calculatePrefixLiveBlockBoundaries,
  hasPrefixLiveBlocksUpdateWork,
  updatePrefixLiveBlocksMemoryState,
} from './prefix-live-blocks'
import { buildSummaryWindowMemoryPlan } from './summary-window'
import type {
  BuildMemoryPlanOptions,
  HasMemoryUpdateWorkOptions,
  MemoryPlan,
  UpdateMemoryStateOptions,
} from './types'

export async function buildMemoryPlan({
  supabase,
  chatId,
  sanitizedMessages,
  totalConversationMessages,
  baseSystemPrompt,
  extraDynamicContext,
  modelConfig,
  transcriptCoverage,
  transcriptStartOrdinal,
}: BuildMemoryPlanOptions): Promise<MemoryPlan> {
  const memory = resolveChatMemoryConfig(modelConfig)

  if (memory.mode === 'summary_window') {
    return buildSummaryWindowMemoryPlan({
      supabase,
      chatId,
      sanitizedMessages,
      totalConversationMessages,
      baseSystemPrompt,
      extraDynamicContext,
    })
  }

  return buildPrefixLiveBlocksMemoryPlan({
    supabase,
    chatId,
    baseSystemPrompt,
    extraDynamicContext,
    sanitizedMessages,
    transcriptCoverage,
    transcriptStartOrdinal,
  })
}

export async function updateMemoryState({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  regenerate,
  modelConfig,
}: UpdateMemoryStateOptions): Promise<void> {
  const memory = resolveChatMemoryConfig(modelConfig)

  if (memory.mode === 'summary_window') {
    await updateSummaries({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      regenerate,
    })
    return
  }

  await updatePrefixLiveBlocksMemoryState({
    supabase,
    chatId,
    userId,
    model,
    provider,
    modelName,
    regenerate,
    modelConfig,
  })
}

export async function hasMemoryUpdateWork({
  supabase,
  chatId,
  regenerate,
  modelConfig,
}: HasMemoryUpdateWorkOptions): Promise<boolean> {
  if (hasExplicitRegenerationRanges(regenerate)) {
    return true
  }

  const memory = resolveChatMemoryConfig(modelConfig)
  if (memory.mode === 'summary_window') {
    const totalMessages = await getMessageCount(supabase, chatId)
    if (totalMessages === null) {
      throw new Error(
        `Failed to determine projected conversation size for summary work check: ${chatId}`,
      )
    }

    const lastProcessedChunkEnd = await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_CHUNK)
    const hasChunkWork =
      calculateChunkBoundaries(totalMessages, lastProcessedChunkEnd ?? 0, CHUNK_SIZE).length > 0
    if (hasChunkWork) {
      return true
    }

    return hasPendingCanonicalFactWork({
      supabase,
      chatId,
      sealedThroughSeq: totalMessages - CHUNK_SIZE,
    })
  }

  return hasPrefixLiveBlocksUpdateWork({
    supabase,
    chatId,
    regenerate,
    modelConfig,
  })
}

function hasExplicitRegenerationRanges(
  regenerate?: HasMemoryUpdateWorkOptions['regenerate'],
): boolean {
  return (
    (regenerate?.chunkRanges?.length ?? 0) > 0 ||
    (regenerate?.factRanges?.length ?? 0) > 0 ||
    (regenerate?.metaRanges?.length ?? 0) > 0
  )
}

type CanonicalRangeRow = {
  start_seq: number
  end_seq: number
}

function isCanonicalChunkRange(row: CanonicalRangeRow): boolean {
  return (
    row.start_seq >= 1 &&
    row.end_seq === row.start_seq + CHUNK_SIZE - 1 &&
    (row.start_seq - 1) % CHUNK_SIZE === 0
  )
}

function getRangeKey(row: CanonicalRangeRow): string {
  return `${row.start_seq}-${row.end_seq}`
}

async function hasPendingCanonicalFactWork({
  supabase,
  chatId,
  sealedThroughSeq,
}: {
  supabase: HasMemoryUpdateWorkOptions['supabase']
  chatId: string
  sealedThroughSeq: number
}): Promise<boolean> {
  const normalizedSealedThroughSeq = Math.max(0, Math.trunc(sealedThroughSeq))
  if (normalizedSealedThroughSeq < CHUNK_SIZE) {
    return false
  }

  const episodicMemorySettings = await loadChatEpisodicMemorySettings({
    supabase,
    chatId,
  })
  if (!episodicMemorySettings.enabled) {
    return false
  }

  const [{ data: chunkRows, error: chunkError }, { data: factRows, error: factError }] =
    await Promise.all([
      supabase
        .from('chat_summaries')
        .select<'start_seq, end_seq'>('start_seq, end_seq')
        .eq('chat_id', chatId)
        .eq('level', SUMMARY_LEVEL_CHUNK)
        .lte('end_seq', normalizedSealedThroughSeq)
        .order('start_seq', { ascending: true }),
      supabase
        .from('chat_facts')
        .select<'start_seq, end_seq'>('start_seq, end_seq')
        .eq('chat_id', chatId)
        .lte('end_seq', normalizedSealedThroughSeq)
        .order('start_seq', { ascending: true }),
    ])

  if (chunkError) {
    throw new Error(
      `Failed to inspect canonical chunk summaries for fact work: ${chunkError.message}`,
    )
  }

  if (factError) {
    throw new Error(`Failed to inspect canonical facts for fact work: ${factError.message}`)
  }

  const factKeys = new Set(
    ((factRows ?? []) as CanonicalRangeRow[]).filter(isCanonicalChunkRange).map(getRangeKey),
  )

  return ((chunkRows ?? []) as CanonicalRangeRow[])
    .filter(isCanonicalChunkRange)
    .some((row) => !factKeys.has(getRangeKey(row)))
}

export type { SummaryRange }
export type {
  BuildMemoryPlanOptions,
  HasMemoryUpdateWorkOptions,
  MemoryPlan,
  MemoryPromptBlock,
  UpdateMemoryStateOptions,
} from './types'
export { calculatePrefixLiveBlockBoundaries }
