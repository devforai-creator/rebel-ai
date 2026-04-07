import type { ChatSummary } from '@/types/database.types'
import { generateFactEmbedding } from '@/lib/embeddings'
import type {
  SummaryRow,
  FactRow,
  BuildContextOptions,
  BuildContextResult,
  SearchRelevantFactsOptions,
  RagResultInfo,
} from './types'
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

/**
 * Filters out summaries that are fully covered by higher-level summaries.
 * Higher level (meta → super meta) entries take precedence over lower levels.
 */
export function filterRedundantChunks(
  summaries: Array<Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>>,
): Array<Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>> {
  if (summaries.length === 0) {
    return summaries
  }

  const sortedByPriority = summaries.slice().sort((a, b) => {
    if (a.level === b.level) {
      return a.start_seq - b.start_seq
    }
    return b.level - a.level
  })

  const retained: Array<Pick<ChatSummary, 'level' | 'start_seq' | 'end_seq' | 'summary'>> = []
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
}: SearchRelevantFactsOptions): Promise<FactRow[]> {
  logRagDebug('[RAG] searchRelevantFacts called', {
    chatId,
    userId,
    recentMessagesCount: recentMessages.length,
    topK,
  })

  if (recentMessages.length === 0) {
    logRagDebug('[RAG] No recent messages, returning empty')
    return []
  }

  const queryMessages = recentMessages.slice(-RAG_QUERY_MESSAGES)
  const queryText = queryMessages.map((msg) => `${msg.role}: ${msg.content}`).join('\n')

  logRagDebug('[RAG] Generating query embedding', {
    queryTextLength: queryText.length,
    queryMessagesCount: queryMessages.length,
  })

  const queryEmbedding = await generateFactEmbedding(queryText, userId, supabase)

  if (!queryEmbedding) {
    logRagDebug('[RAG] Query embedding generation failed (returned null)')
    return []
  }

  logRagDebug('[RAG] Query embedding generated successfully', {
    embeddingLength: queryEmbedding.length,
  })

  const { data, error } = await supabase.rpc('match_chat_facts', {
    chat_id: chatId,
    target_user_id: userId,
    query_embedding: queryEmbedding,
    match_threshold: RAG_SIMILARITY_THRESHOLD,
    match_count: topK,
  })

  if (error) {
    console.error('[RAG] match_chat_facts RPC failed:', {
      error: error.message,
      code: error.code,
      details: error.details,
    })
    return []
  }

  const results = (data ?? []) as FactRow[]

  logRagDebug('[RAG] match_chat_facts RPC succeeded', {
    resultsCount: results.length,
    similarities: results.map((r) => ({
      seq: `${r.start_seq}-${r.end_seq}`,
      similarity: r.similarity?.toFixed(3),
    })),
  })

  return results
}

/**
 * Build context for chat generation including summaries, facts, and extra dynamic context.
 */
export async function buildContext({
  supabase,
  chatId,
  sanitizedMessages,
  baseSystemPrompt,
  extraDynamicContext,
}: BuildContextOptions): Promise<BuildContextResult> {
  const trimmedMessages = sanitizedMessages.slice(-CONTEXT_WINDOW)
  const totalIncludingCurrent = sanitizedMessages.length

  // Initialize RAG info (disabled by default)
  const ragInfo: RagResultInfo = {
    enabled: false,
    threshold: RAG_SIMILARITY_THRESHOLD,
    topK: RAG_TOP_K,
    results: [],
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

  // Load episodic memory (chat_facts) - fallback to existing behavior
  const { data: fallbackFacts, error: factsError } = await supabase
    .from('chat_facts')
    .select<'start_seq, end_seq, facts'>('start_seq, end_seq, facts')
    .eq('chat_id', chatId)
    .lte('end_seq', summaryCutoff)
    .order('start_seq', { ascending: true })

  if (factsError) {
    console.error('Failed to load chat facts:', factsError.message)
  }

  let ragUsed = false
  let factRows = (fallbackFacts ?? []) as FactRow[]

  const { data: chatOwner, error: chatOwnerError } = await supabase
    .from('chats')
    .select('user_id')
    .eq('id', chatId)
    .single()

  if (chatOwnerError) {
    console.error('Failed to load chat owner for RAG facts:', chatOwnerError.message)
  }

  if (chatOwner?.user_id) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('enable_episodic_rag')
      .eq('id', chatOwner.user_id)
      .single()

    if (profileError) {
      console.error('Failed to load profile RAG flag:', profileError.message)
    }

    if (profile?.enable_episodic_rag) {
      ragInfo.enabled = true
      const ragFacts = await searchRelevantFacts({
        supabase,
        chatId,
        userId: chatOwner.user_id,
        recentMessages: trimmedMessages,
      })

      // Store RAG results for debug_info
      ragInfo.results = ragFacts.map((r) => ({
        seq: `${r.start_seq}-${r.end_seq}`,
        similarity: r.similarity ?? 0,
        preview: r.facts.slice(0, 80) + (r.facts.length > 80 ? '...' : ''),
      }))

      // When RAG is enabled, only use RAG results (no fallback to all facts)
      // This reduces noise by excluding low-relevance facts
      factRows = ragFacts
      ragUsed = ragFacts.length > 0
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
    const heading = ragUsed
      ? '=== Key Facts to Remember (by relevance) ==='
      : '=== Key Facts to Remember ==='
    dynamicParts.push(`${heading}\n` + formatFacts(factRows))
  }

  dynamicParts.push(...extraDynamicParts)

  // For backwards compatibility, systemPrompt still contains everything combined
  // Callers that support separated context (Anthropic) can use dynamicContext separately
  return buildResult(dynamicParts)
}
