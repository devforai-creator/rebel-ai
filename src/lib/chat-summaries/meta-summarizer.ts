import type { ChatSummary, ChatSummaryInsert } from '@/types/database.types'
import { resolvePromptCacheDecision } from '@/lib/llm/prompt-cache'
import type { ChunkSummaryRow, ProcessMetaOptions, CreateHigherLevelSummaryOptions } from './types'
import {
  SUMMARY_GROUP_SIZE,
  SUPER_SUMMARY_GROUP_SIZE,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
  MESSAGE_CHAR_LIMIT,
  META_SUMMARY_MAX_TOKENS,
} from './config'
import {
  truncateText,
  estimateTokenCount,
  buildHigherLevelFallbackSummary,
  areChunksSequential,
} from './formatters'
import { getLastSummaryEnd } from './db-helpers'
import { generateSummaryWithFallback } from './chunk-summarizer'

/**
 * Create a higher-level summary (meta or super-meta) from segments
 */
export async function createHigherLevelSummary({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  segments,
  startSeq,
  endSeq,
  systemPrompt,
  targetLevel,
  fallbackLabel,
}: CreateHigherLevelSummaryOptions): Promise<void> {
  const combinedText = segments
    .map(
      (segment) =>
        `Messages ${segment.start_seq}-${segment.end_seq}:\n${truncateText(
          segment.summary.trim(),
          MESSAGE_CHAR_LIMIT,
        )}`,
    )
    .join('\n\n')

  const promptContent = `Create a concise higher-level summary of the following conversation summaries:\n\n${combinedText}`
  const cachePrefix = targetLevel === SUMMARY_LEVEL_SUPER_META ? 'super-meta' : 'meta'

  const promptCache = resolvePromptCacheDecision({
    provider,
    modelName,
    systemPrompt,
    messages: [{ role: 'user', content: promptContent }],
    totalInputTokens: estimateTokenCount(systemPrompt) + estimateTokenCount(promptContent),
    cacheKeyOverride:
      provider === 'openai' ? `${cachePrefix}:${chatId}:${startSeq}-${endSeq}` : undefined,
    retentionPreference: '24h',
  })

  const { summaryText, tokenCount } = await generateSummaryWithFallback({
    model,
    provider,
    systemPrompt,
    prompt: promptContent,
    maxTokens: META_SUMMARY_MAX_TOKENS,
    fallbackLabel,
    fallbackTextFactory: () => buildHigherLevelFallbackSummary(segments),
    promptCache,
  })

  await supabase.from('chat_summaries').insert<ChatSummaryInsert>({
    chat_id: chatId,
    user_id: userId,
    level: targetLevel,
    start_seq: startSeq,
    end_seq: endSeq,
    summary: summaryText,
    token_count: tokenCount,
  })
}

/**
 * Process meta summaries (combine chunk summaries)
 */
export async function processMetaSummaries({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  metaPrompt,
}: ProcessMetaOptions): Promise<void> {
  let lastMetaEnd = (await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_META)) ?? 0

  while (true) {
    const { data: candidateChunks, error: chunkError } = await supabase
      .from('chat_summaries')
      .select<'id, start_seq, end_seq, summary'>('id, start_seq, end_seq, summary')
      .eq('chat_id', chatId)
      .eq('level', SUMMARY_LEVEL_CHUNK)
      .gt('start_seq', lastMetaEnd)
      .order('start_seq', { ascending: true })
      .limit(SUMMARY_GROUP_SIZE)

    if (chunkError) {
      console.error('Failed to load chunk summaries:', chunkError.message)
      return
    }

    const chunkRows = (candidateChunks ?? []) as ChunkSummaryRow[]

    if (chunkRows.length < SUMMARY_GROUP_SIZE) {
      return
    }

    if (!areChunksSequential(chunkRows)) {
      console.warn('Chunk summaries are not sequential; skipping meta summary generation')
      return
    }

    const metaStart = chunkRows[0].start_seq
    const metaEnd = chunkRows[chunkRows.length - 1].end_seq

    // Race condition prevention: check for duplicates before LLM call
    const { data: existingMeta } = await supabase
      .from('chat_summaries')
      .select('id')
      .eq('chat_id', chatId)
      .eq('level', SUMMARY_LEVEL_META)
      .eq('start_seq', metaStart)
      .eq('end_seq', metaEnd)
      .maybeSingle()

    if (existingMeta) {
      return
    }

    try {
      await createHigherLevelSummary({
        supabase,
        chatId,
        userId,
        model,
        provider,
        modelName,
        segments: chunkRows,
        startSeq: metaStart,
        endSeq: metaEnd,
        systemPrompt: metaPrompt,
        targetLevel: SUMMARY_LEVEL_META,
        fallbackLabel: `meta ${metaStart}-${metaEnd}`,
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        return
      }
      console.error('Failed to create meta summary:', error)
      return
    }

    lastMetaEnd = metaEnd
  }
}

/**
 * Process super meta summaries (combine meta summaries)
 * NOTE: Currently disabled in main flow
 */
export async function processSuperMetaSummaries({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  metaPrompt,
}: ProcessMetaOptions): Promise<void> {
  let lastSuperMetaEnd = (await getLastSummaryEnd(supabase, chatId, SUMMARY_LEVEL_SUPER_META)) ?? 0

  while (true) {
    const { data: candidateMetaRows, error: fetchError } = await supabase
      .from('chat_summaries')
      .select<'id, start_seq, end_seq, summary'>('id, start_seq, end_seq, summary')
      .eq('chat_id', chatId)
      .eq('level', SUMMARY_LEVEL_META)
      .gt('start_seq', lastSuperMetaEnd)
      .order('start_seq', { ascending: true })
      .limit(SUPER_SUMMARY_GROUP_SIZE)

    if (fetchError) {
      console.error('Failed to load meta summaries for super meta generation:', fetchError.message)
      return
    }

    const metaRows = (candidateMetaRows ?? []) as Array<
      Pick<ChatSummary, 'start_seq' | 'end_seq' | 'summary'>
    >

    if (metaRows.length < SUPER_SUMMARY_GROUP_SIZE) {
      return
    }

    if (!areChunksSequential(metaRows)) {
      console.warn('Meta summaries are not sequential; skipping super meta generation')
      return
    }

    const superStart = metaRows[0].start_seq
    const superEnd = metaRows[metaRows.length - 1].end_seq

    const { data: existingSuper } = await supabase
      .from('chat_summaries')
      .select('id')
      .eq('chat_id', chatId)
      .eq('level', SUMMARY_LEVEL_SUPER_META)
      .eq('start_seq', superStart)
      .eq('end_seq', superEnd)
      .maybeSingle()

    if (existingSuper) {
      return
    }

    try {
      await createHigherLevelSummary({
        supabase,
        chatId,
        userId,
        model,
        provider,
        modelName,
        segments: metaRows,
        startSeq: superStart,
        endSeq: superEnd,
        systemPrompt: metaPrompt,
        targetLevel: SUMMARY_LEVEL_SUPER_META,
        fallbackLabel: `super-meta ${superStart}-${superEnd}`,
      })
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as { code?: string }).code === '23505'
      ) {
        return
      }
      console.error('Failed to create super meta summary:', error)
      return
    }

    lastSuperMetaEnd = superEnd
  }
}
