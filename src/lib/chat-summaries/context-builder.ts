import type { ChatSummary } from '@/types/database.types'
import { generateFactEmbedding } from '@/lib/embeddings'
import type {
  SummaryRow,
  FactRow,
  BuildContextOptions,
  BuildContextResult,
  SearchRelevantFactsOptions,
  SearchRelevantFactsResult,
  RagResultInfo,
  RagDiagnosticsInfo,
} from './types'
import { loadChatEpisodicMemorySettings } from './episodic-memory'
import {
  CONTEXT_WINDOW,
  SUMMARY_LEVEL_SUPER_META,
  RAG_TOP_K,
  RAG_QUERY_MESSAGES,
  RAG_SIMILARITY_THRESHOLD,
} from './config'
import { formatSummarySegments, formatFacts } from './formatters'
import { getLatestMessageSequence } from './db-helpers'

const RAG_DEBUG_ENABLED = process.env.RAG_DEBUG === 'true'

function logRagDebug(...args: unknown[]): void {
  if (RAG_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function roundMetricDuration(durationMs: number): number {
  return Math.max(0, Math.round(durationMs))
}

async function loadRagCandidateFactCount({
  supabase,
  chatId,
  userId,
}: Pick<SearchRelevantFactsOptions, 'supabase' | 'chatId' | 'userId'>): Promise<number | null> {
  const { count, error } = await supabase
    .from('chat_facts')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .eq('user_id', userId)
    .not('embedding', 'is', null)

  if (error) {
    logRagDebug('[RAG] Candidate fact count query failed', {
      error: error.message,
    })
    return null
  }

  return count ?? 0
}

/**
 * Filters out summaries that are fully covered by higher-level summaries.
 * Higher level (meta → super meta) entries take precedence over lower levels.
 */
export function filterRedundantChunks<
  T extends Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>,
>(summaries: T[]): T[] {
  if (summaries.length === 0) {
    return summaries
  }

  const sortedByPriority = summaries.slice().sort((a, b) => {
    if (a.level === b.level) {
      return a.start_seq - b.start_seq
    }
    return b.level - a.level
  })

  const retained: T[] = []
  const coverage: Array<{ start: number; end: number; level: number }> = []

  for (const summary of sortedByPriority) {
    const isCovered = coverage.some(
      (range) =>
        range.level > summary.level &&
        summary.start_seq >= range.start &&
        summary.end_seq <= range.end,
    )

    if (!isCovered) {
      retained.push(summary)
      coverage.push({
        start: summary.start_seq,
        end: summary.end_seq,
        level: summary.level,
      })
    }
  }

  return retained.sort((a, b) => a.start_seq - b.start_seq)
}

/**
 * Search for relevant facts using RAG (vector similarity search)
 */
export async function searchRelevantFacts({
  supabase,
  chatId,
  userId,
  recentMessages,
  topK = RAG_TOP_K,
  profileSettings,
}: SearchRelevantFactsOptions): Promise<SearchRelevantFactsResult> {
  const diagnostics: RagDiagnosticsInfo = {
    recentMessagesCount: recentMessages.length,
    queryMessagesCount: 0,
    queryTextChars: 0,
    embeddingMs: null,
    matchRpcMs: null,
    totalRetrievalMs: null,
    candidateFactCount: null,
    resultCount: 0,
    usedResultCount: 0,
    skippedReason: null,
  }

  logRagDebug('[RAG] searchRelevantFacts called', {
    chatId,
    userId,
    recentMessagesCount: recentMessages.length,
    topK,
  })

  if (recentMessages.length === 0) {
    logRagDebug('[RAG] No recent messages, returning empty')
    diagnostics.skippedReason = 'no_recent_messages'
    return {
      facts: [],
      diagnostics,
    }
  }

  const queryMessages = recentMessages.slice(-RAG_QUERY_MESSAGES)
  const queryText = queryMessages.map((msg) => `${msg.role}: ${msg.content}`).join('\n')
  diagnostics.queryMessagesCount = queryMessages.length
  diagnostics.queryTextChars = queryText.length

  if (RAG_DEBUG_ENABLED) {
    diagnostics.candidateFactCount = await loadRagCandidateFactCount({
      supabase,
      chatId,
      userId,
    })
  }

  const retrievalStart = performance.now()

  logRagDebug('[RAG] Generating query embedding', {
    queryTextLength: queryText.length,
    queryMessagesCount: queryMessages.length,
  })

  const embeddingStart = performance.now()
  const queryEmbedding = await generateFactEmbedding(queryText, userId, supabase, {
    profileSettings,
  })
  diagnostics.embeddingMs = roundMetricDuration(performance.now() - embeddingStart)

  if (!queryEmbedding) {
    logRagDebug('[RAG] Query embedding generation failed (returned null)')
    diagnostics.totalRetrievalMs = roundMetricDuration(performance.now() - retrievalStart)
    diagnostics.skippedReason = 'embedding_unavailable'
    return {
      facts: [],
      diagnostics,
    }
  }

  logRagDebug('[RAG] Query embedding generated successfully', {
    embeddingLength: queryEmbedding.length,
  })

  const rpcStart = performance.now()
  const { data, error } = await supabase.rpc('match_chat_facts', {
    chat_id: chatId,
    target_user_id: userId,
    query_embedding: queryEmbedding,
    match_threshold: RAG_SIMILARITY_THRESHOLD,
    match_count: topK,
  })
  diagnostics.matchRpcMs = roundMetricDuration(performance.now() - rpcStart)

  if (error) {
    console.error('[RAG] match_chat_facts RPC failed:', {
      error: error.message,
      code: error.code,
      details: error.details,
    })
    diagnostics.totalRetrievalMs = roundMetricDuration(performance.now() - retrievalStart)
    diagnostics.skippedReason = 'rpc_error'
    return {
      facts: [],
      diagnostics,
    }
  }

  const results = (data ?? []) as FactRow[]
  diagnostics.resultCount = results.length
  diagnostics.usedResultCount = results.length
  diagnostics.totalRetrievalMs = roundMetricDuration(performance.now() - retrievalStart)
  diagnostics.skippedReason = results.length > 0 ? null : 'no_matches'

  logRagDebug('[RAG] match_chat_facts RPC succeeded', {
    resultsCount: results.length,
    diagnostics,
    similarities: results.map((r) => ({
      seq: `${r.start_seq}-${r.end_seq}`,
      similarity: r.similarity?.toFixed(3),
    })),
  })

  return {
    facts: results,
    diagnostics,
  }
}

/**
 * Build context for chat generation including summaries, facts, and extra dynamic context.
 */
export async function buildContext({
  supabase,
  chatId,
  sanitizedMessages,
  totalConversationMessages,
  baseSystemPrompt,
  extraDynamicContext,
}: BuildContextOptions): Promise<BuildContextResult> {
  const trimmedMessages = sanitizedMessages.slice(-CONTEXT_WINDOW)
  const totalIncludingCurrent = totalConversationMessages ?? sanitizedMessages.length

  // Initialize RAG info (disabled by default)
  const ragInfo: RagResultInfo = {
    enabled: false,
    threshold: RAG_SIMILARITY_THRESHOLD,
    topK: RAG_TOP_K,
    results: [],
    diagnostics: {},
  }

  const extraDynamicParts = (extraDynamicContext ?? []).filter(
    (part) => part && part.trim().length > 0,
  )

  const buildResult = (dynamicParts: string[]): BuildContextResult => {
    if (dynamicParts.length === 0) {
      return {
        systemPrompt: baseSystemPrompt,
        dynamicContext: null,
        recentMessages: trimmedMessages,
        ragInfo,
      }
    }

    const dynamicContext = dynamicParts.join('\n\n')
    const basePrompt = baseSystemPrompt.trim()
    const systemPrompt = basePrompt ? `${basePrompt}\n\n${dynamicContext}` : dynamicContext

    return {
      systemPrompt,
      dynamicContext,
      recentMessages: trimmedMessages,
      ragInfo,
    }
  }

  if (totalIncludingCurrent <= CONTEXT_WINDOW) {
    return buildResult(extraDynamicParts)
  }

  const latestSequence = await getLatestMessageSequence(supabase, chatId)
  const summaryCutoff =
    typeof latestSequence === 'number'
      ? latestSequence - CONTEXT_WINDOW
      : totalIncludingCurrent - CONTEXT_WINDOW

  if (summaryCutoff <= 0) {
    return buildResult(extraDynamicParts)
  }

  const { data: summaries, error: summaryError } = await supabase
    .from('chat_summaries')
    .select<'level, start_seq, end_seq, summary'>('level, start_seq, end_seq, summary')
    .eq('chat_id', chatId)
    .lte('end_seq', summaryCutoff)
    .order('level', { ascending: false })
    .order('start_seq', { ascending: true })

  if (summaryError) {
    console.error('Failed to load summaries:', summaryError.message)
    return buildResult(extraDynamicParts)
  }

  const summaryRows = (summaries ?? []) as SummaryRow[]

  // Exclude super meta summaries (level 2) from context
  const summariesWithoutSuperMeta = summaryRows.filter(
    (row) => row.level !== SUMMARY_LEVEL_SUPER_META,
  )

  // Filter out chunk summaries that are covered by meta summaries
  const filteredSummaries = filterRedundantChunks(summariesWithoutSuperMeta)

  const summarySegments =
    filteredSummaries.length > 0 ? formatSummarySegments(filteredSummaries) : []

  const episodicMemorySettings = await loadChatEpisodicMemorySettings({
    supabase,
    chatId,
  })
  let factRows: FactRow[] = []

  if (episodicMemorySettings.enabled && episodicMemorySettings.userId) {
    ragInfo.enabled = true
    const { facts: ragFacts, diagnostics } = await searchRelevantFacts({
      supabase,
      chatId,
      userId: episodicMemorySettings.userId,
      recentMessages: trimmedMessages,
      profileSettings: episodicMemorySettings.profileSettings,
    })
    ragInfo.diagnostics = {
      ...ragInfo.diagnostics,
      ...diagnostics,
    }

    ragInfo.results = ragFacts.map((r) => ({
      seq: `${r.start_seq}-${r.end_seq}`,
      similarity: r.similarity ?? 0,
      preview: r.facts.slice(0, 80) + (r.facts.length > 80 ? '...' : ''),
    }))

    factRows = ragFacts
  } else {
    ragInfo.diagnostics = {
      ...ragInfo.diagnostics,
      skippedReason: 'disabled',
    }
  }

  if (summarySegments.length === 0 && factRows.length === 0) {
    return buildResult(extraDynamicParts)
  }

  // Build dynamic context separately (summaries, facts, extra blocks)
  // This separation allows Anthropic to cache the static system prompt
  // while the dynamic context changes more frequently
  const dynamicParts: string[] = []

  if (summarySegments.length > 0) {
    dynamicParts.push(`=== Previous Conversation Summary ===\n` + summarySegments.join('\n\n'))
  }

  if (factRows.length > 0) {
    dynamicParts.push(`=== Key Facts to Remember (by relevance) ===\n` + formatFacts(factRows))
  }

  dynamicParts.push(...extraDynamicParts)

  // For backwards compatibility, systemPrompt still contains everything combined
  // Callers that support separated context (Anthropic) can use dynamicContext separately
  return buildResult(dynamicParts)
}
