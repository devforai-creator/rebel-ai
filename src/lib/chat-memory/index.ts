import type { ChatModelConfig } from '@/lib/chat/model-config'
import { resolveChatMemoryConfig } from '@/lib/chat/model-config'
import { buildContext } from '@/lib/chat-summaries'
import {
  DEFAULT_CHUNK_SUMMARY_PROMPT,
  DEFAULT_FACT_EXTRACTION_PROMPT,
  DEFAULT_META_SUMMARY_PROMPT,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_SUPER_META,
} from '@/lib/chat-summaries/config'
import { createChunkFacts, createChunkSummary } from '@/lib/chat-summaries/chunk-summarizer'
import { filterRedundantChunks } from '@/lib/chat-summaries/context-builder'
import { getLastSummaryEnd, getMessageCount } from '@/lib/chat-summaries/db-helpers'
import { formatFacts, formatSummarySegments } from '@/lib/chat-summaries/formatters'
import { processMetaSummaries } from '@/lib/chat-summaries/meta-summarizer'
import { processRegenerationRequests } from '@/lib/chat-summaries/regeneration'
import { updateSummaries } from '@/lib/chat-summaries/index'
import { loadProjectedConversationMessages } from '@/lib/chat/turns'
import type {
  BuildContextOptions,
  RagResultInfo,
  SanitizedMessage,
  ServerSupabaseClient,
  SummaryRange,
  UpdateSummariesOptions,
} from '@/lib/chat-summaries/types'
import type { ChatSummary } from '@/types/database.types'

export type MemoryPromptBlock = {
  role: 'system' | 'user' | 'assistant'
  content: string
  cachePreference: 'prefer-cache' | 'no-preference' | 'avoid-cache'
  stability: 'static' | 'sealed' | 'live'
}

export type MemoryPlan = {
  mode: 'summary_window' | 'prefix_live_blocks'
  promptBlocks: MemoryPromptBlock[]
  fallbackSystemPrompt: string
  fallbackMessages: SanitizedMessage[]
  staticSystemPrompt: string
  dynamicContext: string | null
  ragInfo?: RagResultInfo
}

type BuildMemoryPlanOptions = BuildContextOptions & {
  modelConfig?: ChatModelConfig | null
}

type UpdateMemoryStateOptions = UpdateSummariesOptions & {
  modelConfig?: ChatModelConfig | null
}

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

const EMPTY_RAG_INFO: RagResultInfo = {
  enabled: false,
  threshold: 0.6,
  topK: 5,
  results: [],
}

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
    return buildSummaryWindowPlan({
      supabase,
      chatId,
      sanitizedMessages,
      baseSystemPrompt,
      extraDynamicContext,
    })
  }

  return buildPrefixLiveBlocksPlan({
    supabase,
    chatId,
    baseSystemPrompt,
    extraDynamicContext,
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

async function buildSummaryWindowPlan({
  supabase,
  chatId,
  sanitizedMessages,
  baseSystemPrompt,
  extraDynamicContext,
}: BuildContextOptions): Promise<MemoryPlan> {
  const result = await buildContext({
    supabase,
    chatId,
    sanitizedMessages,
    baseSystemPrompt,
    extraDynamicContext,
  })

  const promptBlocks: MemoryPromptBlock[] = []
  const staticSystemPrompt = baseSystemPrompt.trim()

  if (staticSystemPrompt) {
    promptBlocks.push({
      role: 'system',
      content: staticSystemPrompt,
      cachePreference: 'prefer-cache',
      stability: 'static',
    })
  }

  if (result.dynamicContext) {
    promptBlocks.push({
      role: 'system',
      content: result.dynamicContext,
      cachePreference: 'avoid-cache',
      stability: 'sealed',
    })
  }

  for (const message of result.recentMessages) {
    promptBlocks.push({
      role: message.role,
      content: message.content,
      cachePreference: 'avoid-cache',
      stability: 'live',
    })
  }

  return {
    mode: 'summary_window',
    promptBlocks,
    fallbackSystemPrompt: result.systemPrompt,
    fallbackMessages: result.recentMessages,
    staticSystemPrompt,
    dynamicContext: result.dynamicContext,
    ragInfo: result.ragInfo,
  }
}

async function buildPrefixLiveBlocksPlan({
  supabase,
  chatId,
  baseSystemPrompt,
  extraDynamicContext,
}: {
  supabase: ServerSupabaseClient
  chatId: string
  baseSystemPrompt: string
  extraDynamicContext?: string[]
}): Promise<MemoryPlan> {
  const lastChunkEnd = (await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_CHUNK)) ?? 0
  const staticSystemPrompt = baseSystemPrompt.trim()
  const promptBlocks: MemoryPromptBlock[] = []
  const dynamicBlocks: string[] = []

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

  let fallbackMessages: SanitizedMessage[] = []

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

async function loadSummaryPromptConfig(
  supabase: ServerSupabaseClient,
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

export type { SummaryRange }
