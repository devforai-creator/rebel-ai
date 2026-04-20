import { resolveChatMemoryConfig } from '@/lib/chat/model-config'
import {
  CHUNK_SIZE,
  SUMMARY_GROUP_SIZE,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
} from '@/lib/chat-summaries/config'
import { filterRedundantChunks } from '@/lib/chat-summaries/context-builder'
import { getLastSummaryEnd, getMessageCount } from '@/lib/chat-summaries/db-helpers'
import {
  areChunksSequential,
  calculateChunkBoundaries,
  formatFacts,
  formatSummarySegments,
} from '@/lib/chat-summaries/formatters'
import { updateCanonicalSealedMemoryArtifacts } from '@/lib/chat-summaries/sealed-memory-writer'
import { loadProjectedConversationMessages } from '@/lib/chat/turns'
import type { ChatSummary } from '@/types/database.types'
import type {
  BuildMemoryPlanOptions,
  HasMemoryUpdateWorkOptions,
  MemoryPlan,
  MemoryPromptBlock,
  UpdateMemoryStateOptions,
} from './types'

type SummaryRow = Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>
type FactRow = {
  start_seq: number
  end_seq: number
  facts: string
}

const EMPTY_RAG_INFO = {
  enabled: false,
  threshold: 0.6,
  topK: 5,
  results: [],
} satisfies NonNullable<MemoryPlan['ragInfo']>

export function calculatePrefixLiveBlockBoundaries(
  totalMessages: number,
  previousEnd: number,
  _sealedChunkSize: number,
  retainTailMessages: number,
): Array<{ start: number; end: number }> {
  const canonicalSealedThroughSeq = totalMessages - retainTailMessages
  if (canonicalSealedThroughSeq < CHUNK_SIZE) {
    return []
  }

  return calculateChunkBoundaries(canonicalSealedThroughSeq + CHUNK_SIZE, previousEnd, CHUNK_SIZE)
}

export async function buildPrefixLiveBlocksMemoryPlan({
  supabase,
  chatId,
  baseSystemPrompt,
  extraDynamicContext,
  sanitizedMessages,
  transcriptCoverage = 'full',
  transcriptStartOrdinal = 1,
}: Pick<
  BuildMemoryPlanOptions,
  | 'supabase'
  | 'chatId'
  | 'baseSystemPrompt'
  | 'extraDynamicContext'
  | 'sanitizedMessages'
  | 'transcriptCoverage'
  | 'transcriptStartOrdinal'
>): Promise<MemoryPlan> {
  const visibleSummaryEnd = (await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_META)) ?? 0
  const staticSystemPrompt = baseSystemPrompt.trim()
  const promptBlocks: MemoryPromptBlock[] = []
  const dynamicBlocks: string[] = []
  const normalizedTranscriptStartOrdinal = Math.max(1, transcriptStartOrdinal)

  if (staticSystemPrompt) {
    promptBlocks.push({
      role: 'system',
      content: staticSystemPrompt,
      cachePreference: 'prefer-cache',
      stability: 'static',
    })
  }

  const extraDynamicParts = (extraDynamicContext ?? []).filter(
    (part) => part && part.trim().length > 0,
  )

  if (visibleSummaryEnd > 0) {
    const { data: summaries, error: summaryError } = await supabase
      .from('chat_summaries')
      .select<'level, start_seq, end_seq, summary'>('level, start_seq, end_seq, summary')
      .eq('chat_id', chatId)
      .lte('end_seq', visibleSummaryEnd)
      .order('level', { ascending: false })
      .order('start_seq', { ascending: true })

    if (summaryError) {
      console.error('[chat-memory] Failed to load prefix summaries:', summaryError.message)
    } else {
      const summaryRows = (summaries ?? []) as SummaryRow[]
      const filtered = filterRedundantChunks(
        summaryRows.filter((row) => row.level !== SUMMARY_LEVEL_SUPER_META),
      )
      const summarySegments = filtered.length > 0 ? formatSummarySegments(filtered) : []

      if (summarySegments.length > 0) {
        const summaryBlock = `=== Previous Conversation Summary ===\n${summarySegments.join('\n\n')}`
        dynamicBlocks.push(summaryBlock)
        promptBlocks.push({
          role: 'system',
          content: summaryBlock,
          cachePreference: 'prefer-cache',
          stability: 'sealed',
        })
      }
    }

    const { data: facts, error: factsError } = await supabase
      .from('chat_facts')
      .select<'start_seq, end_seq, facts'>('start_seq, end_seq, facts')
      .eq('chat_id', chatId)
      .lte('end_seq', visibleSummaryEnd)
      .order('start_seq', { ascending: true })

    if (factsError) {
      console.error('[chat-memory] Failed to load prefix facts:', factsError.message)
    } else {
      const factRows = (facts ?? []) as FactRow[]
      if (factRows.length > 0) {
        const factsBlock = `=== Key Facts to Remember ===\n${formatFacts(factRows)}`
        dynamicBlocks.push(factsBlock)
        promptBlocks.push({
          role: 'system',
          content: factsBlock,
          cachePreference: 'prefer-cache',
          stability: 'sealed',
        })
      }
    }
  }

  for (const part of extraDynamicParts) {
    dynamicBlocks.push(part)
    promptBlocks.push({
      role: 'system',
      content: part,
      cachePreference: 'avoid-cache',
      stability: 'sealed',
    })
  }

  const liveStartOrdinal = Math.max(visibleSummaryEnd + 1, normalizedTranscriptStartOrdinal)
  const liveStartOffset = Math.max(0, liveStartOrdinal - normalizedTranscriptStartOrdinal)
  let fallbackMessages = sanitizedMessages.slice(liveStartOffset).map((message) => ({
    role: message.role,
    content: message.content,
    ...(typeof message.messageId === 'string' ? { messageId: message.messageId } : {}),
  }))

  if (
    fallbackMessages.length === 0 &&
    sanitizedMessages.length === 0 &&
    transcriptCoverage === 'full' &&
    normalizedTranscriptStartOrdinal === 1
  ) {
    try {
      const conversationMessages = await loadProjectedConversationMessages({
        supabase,
        chatId,
      })

      fallbackMessages = conversationMessages.slice(visibleSummaryEnd).map((message) => ({
        role: message.role,
        content: message.content,
        messageId: message.id,
      }))
    } catch (error) {
      console.error(
        '[chat-memory] Failed to load live messages:',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  for (const message of fallbackMessages) {
    promptBlocks.push({
      role: message.role,
      content: message.content,
      cachePreference: 'prefer-cache',
      stability: 'live',
    })
  }

  const fallbackSystemPrompt = [staticSystemPrompt, ...dynamicBlocks].filter(Boolean).join('\n\n')

  return {
    mode: 'prefix_live_blocks',
    promptBlocks,
    fallbackSystemPrompt,
    fallbackMessages,
    staticSystemPrompt,
    dynamicContext: dynamicBlocks.length > 0 ? dynamicBlocks.join('\n\n') : null,
    ragInfo: EMPTY_RAG_INFO,
  }
}

export async function updatePrefixLiveBlocksMemoryState({
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
  const sealedChunkSize = memory.sealEveryMessages - memory.retainTailMessages

  if (sealedChunkSize < 1) {
    console.warn('[chat-memory] Invalid prefix_live_blocks config', {
      chatId,
      userId,
      sealEveryMessages: memory.sealEveryMessages,
      retainTailMessages: memory.retainTailMessages,
    })
    return
  }

  const totalMessages = await getMessageCount(supabase, chatId)
  if (totalMessages === null) {
    return
  }

  try {
    await updateCanonicalSealedMemoryArtifacts({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      regenerate,
      sealedThroughSeq: totalMessages - memory.retainTailMessages,
    })
  } catch (error) {
    console.error('[chat-memory] Failed to update canonical prefix memory artifacts:', error)
  }
}

export async function hasPrefixLiveBlocksUpdateWork({
  supabase,
  chatId,
  regenerate,
  modelConfig,
}: HasMemoryUpdateWorkOptions): Promise<boolean> {
  if (hasRegenerationWork(regenerate)) {
    return true
  }

  const memory = resolveChatMemoryConfig(modelConfig)
  const totalMessages = await getMessageCount(supabase, chatId)
  if (totalMessages === null) {
    return false
  }

  const lastProcessedChunkEnd = await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_CHUNK)
  const hasChunkWork =
    calculatePrefixLiveBlockBoundaries(
      totalMessages,
      lastProcessedChunkEnd ?? 0,
      memory.sealEveryMessages - memory.retainTailMessages,
      memory.retainTailMessages,
    ).length > 0

  if (hasChunkWork) {
    return true
  }

  return hasPendingMetaSummaryWork(supabase, chatId)
}

function hasRegenerationWork(regenerate?: HasMemoryUpdateWorkOptions['regenerate']): boolean {
  const rangeCount =
    (regenerate?.chunkRanges?.length ?? 0) +
    (regenerate?.factRanges?.length ?? 0) +
    (regenerate?.metaRanges?.length ?? 0)

  return rangeCount > 0
}

async function hasPendingMetaSummaryWork(
  supabase: HasMemoryUpdateWorkOptions['supabase'],
  chatId: string,
): Promise<boolean> {
  const lastMetaEnd = (await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_META)) ?? 0

  const { data: candidateChunks, error: chunkError } = await supabase
    .from('chat_summaries')
    .select<'id, start_seq, end_seq, summary'>('id, start_seq, end_seq, summary')
    .eq('chat_id', chatId)
    .eq('level', SUMMARY_LEVEL_CHUNK)
    .gt('start_seq', lastMetaEnd)
    .order('start_seq', { ascending: true })
    .limit(SUMMARY_GROUP_SIZE)

  if (chunkError) {
    console.error('[chat-memory] Failed to inspect pending meta summary work:', chunkError.message)
    return false
  }

  const chunkRows = (candidateChunks ?? []) as Array<Pick<ChatSummary, 'start_seq' | 'end_seq'>>
  return chunkRows.length >= SUMMARY_GROUP_SIZE && areChunksSequential(chunkRows)
}
