import { resolveChatMemoryConfig } from '@/lib/chat/model-config'
import {
  DEFAULT_CHUNK_SUMMARY_PROMPT,
  DEFAULT_FACT_EXTRACTION_PROMPT,
  DEFAULT_META_SUMMARY_PROMPT,
  SUMMARY_GROUP_SIZE,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
} from '@/lib/chat-summaries/config'
import { createChunkFacts, createChunkSummary } from '@/lib/chat-summaries/chunk-summarizer'
import { filterRedundantChunks } from '@/lib/chat-summaries/context-builder'
import { getLastSummaryEnd, getMessageCount } from '@/lib/chat-summaries/db-helpers'
import {
  areChunksSequential,
  formatFacts,
  formatSummarySegments,
} from '@/lib/chat-summaries/formatters'
import { processMetaSummaries } from '@/lib/chat-summaries/meta-summarizer'
import { processRegenerationRequests } from '@/lib/chat-summaries/regeneration'
import { loadProjectedConversationMessages } from '@/lib/chat/turns'
import type { ChatSummary } from '@/types/database.types'
import type {
  BuildMemoryPlanOptions,
  HasMemoryUpdateWorkOptions,
  MemoryPlan,
  MemoryPromptBlock,
  UpdateMemoryStateOptions,
} from './types'

type SummaryPromptConfig = {
  chunkPrompt: string
  metaPrompt: string
  factPrompt: string
}

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
  sealedChunkSize: number,
  retainTailMessages: number,
): Array<{ start: number; end: number }> {
  if (sealedChunkSize < 1) {
    return []
  }

  const latestSealableEnd = totalMessages - retainTailMessages
  if (latestSealableEnd <= previousEnd) {
    return []
  }

  const boundaries: Array<{ start: number; end: number }> = []
  let nextEnd = previousEnd + sealedChunkSize

  while (nextEnd <= latestSealableEnd) {
    boundaries.push({
      start: nextEnd - sealedChunkSize + 1,
      end: nextEnd,
    })
    nextEnd += sealedChunkSize
  }

  return boundaries
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
  const lastChunkEnd = (await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_CHUNK)) ?? 0
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

  if (lastChunkEnd > 0) {
    const { data: summaries, error: summaryError } = await supabase
      .from('chat_summaries')
      .select<'level, start_seq, end_seq, summary'>('level, start_seq, end_seq, summary')
      .eq('chat_id', chatId)
      .lte('end_seq', lastChunkEnd)
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
      .lte('end_seq', lastChunkEnd)
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

  const liveStartOrdinal = Math.max(lastChunkEnd + 1, normalizedTranscriptStartOrdinal)
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

      fallbackMessages = conversationMessages.slice(lastChunkEnd).map((message) => ({
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

  const prompts = await loadSummaryPromptConfig(supabase, userId)

  if (regenerate) {
    await processRegenerationRequests({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      chunkPrompt: prompts.chunkPrompt,
      metaPrompt: prompts.metaPrompt,
      factPrompt: prompts.factPrompt,
      regenerate,
      chunkSize: sealedChunkSize,
    })
  }

  const lastProcessedChunkEnd = await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_CHUNK)
  const boundaries = calculatePrefixLiveBlockBoundaries(
    totalMessages,
    lastProcessedChunkEnd ?? 0,
    sealedChunkSize,
    memory.retainTailMessages,
  )

  if (boundaries.length > 0) {
    const transcriptMessages = (
      await loadProjectedConversationMessages({
        supabase,
        chatId,
      })
    ).map((message) => ({
      role: message.role,
      content: message.content,
    }))

    const { data: existingChunks } = await supabase
      .from('chat_summaries')
      .select('start_seq, end_seq')
      .eq('chat_id', chatId)
      .eq('level', SUMMARY_LEVEL_CHUNK)
      .in(
        'start_seq',
        boundaries.map((boundary) => boundary.start),
      )

    const existingStarts = new Set(existingChunks?.map((row) => row.start_seq) ?? [])
    const toCreate = boundaries.filter((boundary) => !existingStarts.has(boundary.start))

    for (const boundary of toCreate) {
      try {
        await createChunkSummary({
          supabase,
          chatId,
          userId,
          model,
          provider,
          modelName,
          startSeq: boundary.start,
          endSeq: boundary.end,
          systemPrompt: prompts.chunkPrompt,
          expectedMessageCount: sealedChunkSize,
          transcriptMessages,
        })

        await createChunkFacts({
          supabase,
          chatId,
          userId,
          model,
          provider,
          modelName,
          startSeq: boundary.start,
          endSeq: boundary.end,
          factPrompt: prompts.factPrompt,
          transcriptMessages,
        })
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
          continue
        }

        console.error('[chat-memory] Failed to create prefix block summary:', error)
        return
      }
    }
  }

  await processMetaSummaries({
    supabase,
    chatId,
    userId,
    model,
    provider,
    modelName,
    metaPrompt: prompts.metaPrompt,
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

async function loadSummaryPromptConfig(
  supabase: UpdateMemoryStateOptions['supabase'],
  userId: string,
): Promise<SummaryPromptConfig> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('chunk_summary_prompt, meta_summary_prompt, fact_extraction_prompt')
    .eq('id', userId)
    .single()

  return {
    chunkPrompt: profile?.chunk_summary_prompt || DEFAULT_CHUNK_SUMMARY_PROMPT,
    metaPrompt: profile?.meta_summary_prompt || DEFAULT_META_SUMMARY_PROMPT,
    factPrompt: profile?.fact_extraction_prompt || DEFAULT_FACT_EXTRACTION_PROMPT,
  }
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
