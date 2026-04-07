import type { LanguageModel } from 'ai'
import type { ChatSummary } from '@/types/database.types'
import type { ServerSupabaseClient, SummaryRange, RegenerationProcessOptions } from './types'
import {
  CHUNK_SIZE,
  SUMMARY_LEVEL_CHUNK,
  SUMMARY_LEVEL_META,
  SUMMARY_LEVEL_SUPER_META,
  SUPER_SUMMARY_GROUP_SIZE,
} from './config'
import { rangeKey, areChunksSequential } from './formatters'
import { createChunkSummary, createChunkFacts } from './chunk-summarizer'
import { createHigherLevelSummary } from './meta-summarizer'

const SUMMARY_REGENERATION_DEBUG_ENABLED = process.env.SUMMARY_REGENERATION_DEBUG === 'true'

function logRegenerationDebug(...args: unknown[]): void {
  if (SUMMARY_REGENERATION_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

/**
 * Normalize and validate ranges
 */
function normalizeRanges(ranges?: SummaryRange[] | null): SummaryRange[] {
  if (!Array.isArray(ranges)) {
    return []
  }

  const unique = new Map<string, SummaryRange>()

  for (const candidate of ranges) {
    if (!candidate) {
      continue
    }

    const startSeq = Number(candidate.startSeq)
    const endSeq = Number(candidate.endSeq)

    if (!Number.isFinite(startSeq) || !Number.isFinite(endSeq)) {
      continue
    }

    if (startSeq < 1 || endSeq < startSeq) {
      continue
    }

    const key = rangeKey({ startSeq, endSeq })
    if (!unique.has(key)) {
      unique.set(key, { startSeq, endSeq })
    }
  }

  return Array.from(unique.values())
}

/**
 * Regenerate chunk summaries and facts for specified ranges
 */
async function regenerateChunkRanges({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  chunkPrompt,
  factPrompt,
  ranges,
  chunkSize,
}: {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  chunkPrompt: string
  factPrompt: string
  ranges: SummaryRange[]
  chunkSize: number
}): Promise<void> {
  for (const range of ranges) {
    const size = range.endSeq - range.startSeq + 1
    if (size !== chunkSize) {
      console.warn('[summaries] Skipping chunk regeneration due to size mismatch', {
        chatId,
        userId,
        ...range,
        expectedSize: chunkSize,
      })
      continue
    }

    const { error: deleteSummaryError } = await supabase
      .from('chat_summaries')
      .delete()
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .eq('level', SUMMARY_LEVEL_CHUNK)
      .eq('start_seq', range.startSeq)
      .eq('end_seq', range.endSeq)

    if (deleteSummaryError) {
      throw new Error(
        `Failed to delete chunk summary for regeneration: ${deleteSummaryError.message}`,
      )
    }

    const { error: deleteFactsError } = await supabase
      .from('chat_facts')
      .delete()
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .eq('start_seq', range.startSeq)
      .eq('end_seq', range.endSeq)

    if (deleteFactsError) {
      throw new Error(`Failed to delete chunk facts for regeneration: ${deleteFactsError.message}`)
    }

    await createChunkSummary({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      startSeq: range.startSeq,
      endSeq: range.endSeq,
      systemPrompt: chunkPrompt,
      expectedMessageCount: chunkSize,
    })

    await createChunkFacts({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      startSeq: range.startSeq,
      endSeq: range.endSeq,
      factPrompt,
    })
  }
}

/**
 * Regenerate facts only for specified ranges
 */
async function regenerateFactRanges({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  factPrompt,
  ranges,
}: {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  factPrompt: string
  ranges: SummaryRange[]
}): Promise<void> {
  logRegenerationDebug('[Regeneration] Starting fact ranges regeneration', {
    chatId,
    userId,
    rangeCount: ranges.length,
    ranges,
  })

  for (const range of ranges) {
    logRegenerationDebug('[Regeneration] Deleting existing facts for range', {
      chatId,
      startSeq: range.startSeq,
      endSeq: range.endSeq,
    })

    const { error: deleteFactsError } = await supabase
      .from('chat_facts')
      .delete()
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .eq('start_seq', range.startSeq)
      .eq('end_seq', range.endSeq)

    if (deleteFactsError) {
      throw new Error(
        `Failed to delete episodic facts for regeneration: ${deleteFactsError.message}`,
      )
    }

    logRegenerationDebug('[Regeneration] Calling createChunkFacts', {
      chatId,
      startSeq: range.startSeq,
      endSeq: range.endSeq,
    })

    await createChunkFacts({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      startSeq: range.startSeq,
      endSeq: range.endSeq,
      factPrompt,
    })
  }

  logRegenerationDebug('[Regeneration] Completed fact ranges regeneration', {
    chatId,
    rangeCount: ranges.length,
  })
}

/**
 * Rebuild a super meta summary range
 */
async function rebuildSuperMetaRange({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  metaPrompt,
  startSeq,
  endSeq,
}: {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  metaPrompt: string
  startSeq: number
  endSeq: number
}): Promise<void> {
  const { data: metaRows, error: metaError } = await supabase
    .from('chat_summaries')
    .select<'start_seq, end_seq, summary'>('start_seq, end_seq, summary')
    .eq('chat_id', chatId)
    .eq('level', SUMMARY_LEVEL_META)
    .gte('start_seq', startSeq)
    .lte('end_seq', endSeq)
    .order('start_seq', { ascending: true })

  if (metaError) {
    throw new Error(
      `Failed to load meta summaries for super meta regeneration: ${metaError.message}`,
    )
  }

  const normalizedMeta = (metaRows ?? []) as Array<
    Pick<ChatSummary, 'start_seq' | 'end_seq' | 'summary'>
  >

  if (normalizedMeta.length < SUPER_SUMMARY_GROUP_SIZE) {
    console.warn('[summaries] Skipping super meta regeneration; insufficient meta coverage', {
      chatId,
      startSeq,
      endSeq,
      availableCount: normalizedMeta.length,
    })
    return
  }

  const firstMeta = normalizedMeta[0]
  const lastMeta = normalizedMeta[normalizedMeta.length - 1]

  if (
    firstMeta.start_seq !== startSeq ||
    lastMeta.end_seq !== endSeq ||
    !areChunksSequential(normalizedMeta)
  ) {
    console.warn('[summaries] Skipping super meta regeneration due to inconsistent meta coverage', {
      chatId,
      expectedStart: startSeq,
      actualStart: firstMeta.start_seq,
      expectedEnd: endSeq,
      actualEnd: lastMeta.end_seq,
      metaCount: normalizedMeta.length,
    })
    return
  }

  await createHigherLevelSummary({
    supabase,
    chatId,
    userId,
    model,
    provider,
    modelName,
    segments: normalizedMeta,
    startSeq,
    endSeq,
    systemPrompt: metaPrompt,
    targetLevel: SUMMARY_LEVEL_SUPER_META,
    fallbackLabel: `super-meta ${startSeq}-${endSeq}`,
  })
}

/**
 * Regenerate meta summaries for specified ranges
 */
async function regenerateMetaRanges({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  metaPrompt,
  ranges,
}: {
  supabase: ServerSupabaseClient
  chatId: string
  userId: string
  model: LanguageModel
  provider: string
  modelName: string
  metaPrompt: string
  ranges: SummaryRange[]
}): Promise<void> {
  const superMetaRefreshMap = new Map<string, { startSeq: number; endSeq: number }>()

  for (const range of ranges) {
    const { error: deleteMetaError } = await supabase
      .from('chat_summaries')
      .delete()
      .eq('chat_id', chatId)
      .eq('user_id', userId)
      .eq('level', SUMMARY_LEVEL_META)
      .eq('start_seq', range.startSeq)
      .eq('end_seq', range.endSeq)

    if (deleteMetaError) {
      throw new Error(`Failed to delete meta summary for regeneration: ${deleteMetaError.message}`)
    }

    const { data: overlappingSuperMetas, error: superMetaQueryError } = await supabase
      .from('chat_summaries')
      .select<'start_seq, end_seq'>('start_seq, end_seq')
      .eq('chat_id', chatId)
      .eq('level', SUMMARY_LEVEL_SUPER_META)
      .lte('start_seq', range.endSeq)
      .gte('end_seq', range.startSeq)

    if (superMetaQueryError) {
      throw new Error(
        `Failed to load super meta summaries for regeneration: ${superMetaQueryError.message}`,
      )
    }

    for (const superMeta of (overlappingSuperMetas ?? []) as Array<{
      start_seq: number
      end_seq: number
    }>) {
      const key = `${superMeta.start_seq}-${superMeta.end_seq}`
      if (!superMetaRefreshMap.has(key)) {
        superMetaRefreshMap.set(key, {
          startSeq: superMeta.start_seq,
          endSeq: superMeta.end_seq,
        })

        const { error: deleteSuperMetaError } = await supabase
          .from('chat_summaries')
          .delete()
          .eq('chat_id', chatId)
          .eq('level', SUMMARY_LEVEL_SUPER_META)
          .eq('start_seq', superMeta.start_seq)
          .eq('end_seq', superMeta.end_seq)

        if (deleteSuperMetaError) {
          throw new Error(
            `Failed to delete super meta summary for regeneration: ${deleteSuperMetaError.message}`,
          )
        }
      }
    }

    const { data: chunkRows, error: chunkError } = await supabase
      .from('chat_summaries')
      .select<'start_seq, end_seq, summary'>('start_seq, end_seq, summary')
      .eq('chat_id', chatId)
      .eq('level', SUMMARY_LEVEL_CHUNK)
      .gte('start_seq', range.startSeq)
      .lte('end_seq', range.endSeq)
      .order('start_seq', { ascending: true })

    if (chunkError) {
      throw new Error(`Failed to load chunk summaries for meta regeneration: ${chunkError.message}`)
    }

    const normalizedChunks = (chunkRows ?? []) as Array<
      Pick<ChatSummary, 'start_seq' | 'end_seq' | 'summary'>
    >

    if (normalizedChunks.length === 0) {
      console.warn('[summaries] Skipping meta regeneration; no chunk summaries found', {
        chatId,
        userId,
        ...range,
      })
      continue
    }

    const firstChunk = normalizedChunks[0]
    const lastChunk = normalizedChunks[normalizedChunks.length - 1]

    if (
      firstChunk.start_seq !== range.startSeq ||
      lastChunk.end_seq !== range.endSeq ||
      !areChunksSequential(normalizedChunks)
    ) {
      console.warn('[summaries] Skipping meta regeneration due to inconsistent chunk coverage', {
        chatId,
        userId,
        expectedStart: range.startSeq,
        actualStart: firstChunk.start_seq,
        expectedEnd: range.endSeq,
        actualEnd: lastChunk.end_seq,
        chunkCount: normalizedChunks.length,
      })
      continue
    }

    await createHigherLevelSummary({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      segments: normalizedChunks,
      startSeq: range.startSeq,
      endSeq: range.endSeq,
      systemPrompt: metaPrompt,
      targetLevel: SUMMARY_LEVEL_META,
      fallbackLabel: `meta ${range.startSeq}-${range.endSeq}`,
    })
  }

  for (const superRange of superMetaRefreshMap.values()) {
    await rebuildSuperMetaRange({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      metaPrompt,
      startSeq: superRange.startSeq,
      endSeq: superRange.endSeq,
    })
  }
}

/**
 * Process regeneration requests for summaries and facts
 */
export async function processRegenerationRequests({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  chunkPrompt,
  metaPrompt,
  factPrompt,
  regenerate,
  chunkSize = CHUNK_SIZE,
}: RegenerationProcessOptions): Promise<void> {
  logRegenerationDebug('[Regeneration] Processing regeneration requests', {
    chatId,
    userId,
    regenerateConfig: regenerate,
  })

  if (!regenerate) {
    logRegenerationDebug('[Regeneration] No regenerate config provided - skipping')
    return
  }

  const chunkRanges = normalizeRanges(regenerate.chunkRanges)
  const chunkKeys = new Set(chunkRanges.map(rangeKey))
  const factRanges = normalizeRanges(regenerate.factRanges).filter(
    (range) => !chunkKeys.has(rangeKey(range)),
  )
  const metaRanges = normalizeRanges(regenerate.metaRanges)

  logRegenerationDebug('[Regeneration] Normalized ranges', {
    chatId,
    chunkRanges,
    factRanges,
    metaRanges,
    filteredFactCount: normalizeRanges(regenerate.factRanges).length - factRanges.length,
  })

  if (chunkRanges.length > 0) {
    await regenerateChunkRanges({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      chunkPrompt,
      factPrompt,
      ranges: chunkRanges,
      chunkSize,
    })
  }

  if (factRanges.length > 0) {
    await regenerateFactRanges({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      factPrompt,
      ranges: factRanges,
    })
  }

  if (metaRanges.length > 0) {
    await regenerateMetaRanges({
      supabase,
      chatId,
      userId,
      model,
      provider,
      modelName,
      metaPrompt,
      ranges: metaRanges,
    })
  }
}
