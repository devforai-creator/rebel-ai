import { resolveChatMemoryConfig } from '@/lib/chat/model-config'
import { CHUNK_SIZE, SUMMARY_LEVEL_CHUNK } from '@/lib/chat-summaries/config'
import { getLastSummaryEnd, getMessageCount } from '@/lib/chat-summaries/db-helpers'
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
  baseSystemPrompt,
  extraDynamicContext,
  modelConfig,
}: BuildMemoryPlanOptions): Promise<MemoryPlan> {
  const memory = resolveChatMemoryConfig(modelConfig)

  if (memory.mode === 'summary_window') {
    return buildSummaryWindowMemoryPlan({
      supabase,
      chatId,
      sanitizedMessages,
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
      return false
    }

    const lastProcessedChunkEnd = await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_CHUNK)
    return (
      calculateChunkBoundaries(totalMessages, lastProcessedChunkEnd ?? 0, CHUNK_SIZE).length > 0
    )
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

export type { SummaryRange }
export type {
  BuildMemoryPlanOptions,
  HasMemoryUpdateWorkOptions,
  MemoryPlan,
  MemoryPromptBlock,
  UpdateMemoryStateOptions,
} from './types'
export { calculatePrefixLiveBlockBoundaries }
