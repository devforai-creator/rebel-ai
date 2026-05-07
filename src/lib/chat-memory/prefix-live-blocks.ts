import { resolveChatMemoryConfig } from '@/lib/chat/model-config'
import {
  CHUNK_SIZE,
  SUMMARY_GROUP_SIZE,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
  META_SUMMARY_CONTEXT_ROLLOVER_MESSAGES,
} from '@/lib/chat-summaries/config'
import { filterRedundantChunks } from '@/lib/chat-summaries/context-builder'
import { getLastSummaryEnd, getMessageCount } from '@/lib/chat-summaries/db-helpers'
import {
  areChunksSequential,
  calculateChunkBoundaries,
  formatFacts,
  formatSummarySegments,
} from '@/lib/chat-summaries/formatters'
import { loadChatEpisodicMemorySettings } from '@/lib/chat-summaries/episodic-memory'
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
      const metaRolloverCutoff = visibleSummaryEnd - META_SUMMARY_CONTEXT_ROLLOVER_MESSAGES
      const chunkRangeKeys = new Set(
        summaryRows
          .filter((row) => row.level === SUMMARY_LEVEL_CHUNK)
          .map((row) => `${row.start_seq}-${row.end_seq}`),
      )
      const filtered = filterRedundantChunks(
        summaryRows.filter((row) => {
          if (row.level === SUMMARY_LEVEL_SUPER_META) {
            return false
          }

          if (row.level !== SUMMARY_LEVEL_META) {
            return true
          }

          const summarySpan = row.end_seq - row.start_seq + 1
          const hasChunkCoverage = Array.from(
            { length: Math.ceil(summarySpan / CHUNK_SIZE) },
            (_, index) => {
              const start = row.start_seq + index * CHUNK_SIZE
              const end = Math.min(start + CHUNK_SIZE - 1, row.end_seq)
              return chunkRangeKeys.has(`${start}-${end}`)
            },
          ).every(Boolean)

          if (!hasChunkCoverage) {
            return true
          }

          return (
            summarySpan < META_SUMMARY_CONTEXT_ROLLOVER_MESSAGES ||
            row.end_seq <= metaRolloverCutoff
          )
        }),
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

    const episodicMemorySettings = await loadChatEpisodicMemorySettings({
      supabase,
      chatId,
    })

    if (episodicMemorySettings.enabled) {
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

  const totalMessages = await getMessageCount(supabase, chatId)
  if (totalMessages === null) {
    throw new Error(
      `Failed to determine projected conversation size for prefix memory update: ${chatId}`,
    )
  }

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
    throw new Error(
      `Failed to determine projected conversation size for prefix memory work check: ${chatId}`,
    )
  }

  const lastProcessedChunkEnd = await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_CHUNK)
  const hasChunkWork =
    calculatePrefixLiveBlockBoundaries(
      totalMessages,
      lastProcessedChunkEnd ?? 0,
      memory.retainTailMessages,
    ).length > 0

  if (hasChunkWork) {
    return true
  }

  const episodicMemorySettings = await loadChatEpisodicMemorySettings({
    supabase,
    chatId,
  })
  if (episodicMemorySettings.enabled) {
    const sealedThroughSeq = totalMessages - memory.retainTailMessages
    const [{ data: chunkRows, error: chunkError }, { data: factRows, error: factError }] =
      await Promise.all([
        supabase
          .from('chat_summaries')
          .select<'start_seq, end_seq'>('start_seq, end_seq')
          .eq('chat_id', chatId)
          .eq('level', SUMMARY_LEVEL_CHUNK)
          .lte('end_seq', sealedThroughSeq)
          .order('start_seq', { ascending: true }),
        supabase
          .from('chat_facts')
          .select<'start_seq, end_seq'>('start_seq, end_seq')
          .eq('chat_id', chatId)
          .lte('end_seq', sealedThroughSeq)
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
      ((factRows ?? []) as Array<Pick<FactRow, 'start_seq' | 'end_seq'>>)
        .filter((row) => row.end_seq === row.start_seq + CHUNK_SIZE - 1)
        .map((row) => `${row.start_seq}-${row.end_seq}`),
    )

    const hasMissingFacts = ((chunkRows ?? []) as Array<Pick<SummaryRow, 'start_seq' | 'end_seq'>>)
      .filter((row) => row.end_seq === row.start_seq + CHUNK_SIZE - 1)
      .some((row) => !factKeys.has(`${row.start_seq}-${row.end_seq}`))

    if (hasMissingFacts) {
      return true
    }
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
    throw new Error(`Failed to inspect pending meta summary work: ${chunkError.message}`)
  }

  const chunkRows = (candidateChunks ?? []) as Array<Pick<ChatSummary, 'start_seq' | 'end_seq'>>
  return chunkRows.length >= SUMMARY_GROUP_SIZE && areChunksSequential(chunkRows)
}
