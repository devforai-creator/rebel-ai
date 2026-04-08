import { APICallError, generateText } from 'ai'
import type { ChatSummaryInsert } from '@/types/database.types'
import { generateFactEmbedding } from '@/lib/embeddings'
import { getProviderOptions } from '@/lib/llm/provider-options'
import { resolvePromptCacheDecision } from '@/lib/llm/prompt-cache'
import { loadProjectedConversationMessages } from '@/lib/chat/turns'
import type {
  MessageTranscriptRow,
  ProcessChunkOptions,
  CreateChunkSummaryOptions,
  CreateChunkFactsOptions,
  SummaryWithFallbackOptions,
  SummaryWithFallbackResult,
} from './types'
import {
  CHUNK_SIZE,
  SUMMARY_LEVEL_CHUNK,
  MESSAGE_CHAR_LIMIT,
  DEFAULT_LLM_CONFIG,
  CHUNK_SUMMARY_MAX_TOKENS,
} from './config'
import {
  truncateText,
  estimateTokenCount,
  buildChunkFallbackSummary,
  calculateChunkBoundaries,
} from './formatters'

const FACTS_EXTRACTION_DEBUG_ENABLED = process.env.FACTS_EXTRACTION_DEBUG === 'true'

function logFactsExtractionDebug(...args: unknown[]): void {
  if (FACTS_EXTRACTION_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

/**
 * Generate summary with fallback on error
 */
export async function generateSummaryWithFallback({
  model,
  provider,
  systemPrompt,
  prompt,
  maxTokens,
  fallbackLabel,
  fallbackTextFactory,
  promptCache,
}: SummaryWithFallbackOptions): Promise<SummaryWithFallbackResult> {
  try {
    // OpenAI GPT-5.1 doesn't support max_tokens, only max_completion_tokens
    // For OpenAI providers, omit maxTokens but keep temperature: 1 (required by some models like GPT-o3-mini)
    const baseParams =
      provider === 'openai'
        ? { model, system: systemPrompt, prompt, temperature: 1 }
        : { model, system: systemPrompt, prompt, maxTokens, temperature: 1 }

    const providerOptions = getProviderOptions(provider, {
      promptCacheKey: promptCache?.key ?? undefined,
      promptCacheRetention: promptCache?.retention ?? undefined,
    })

    const { text, usage, finishReason } = await generateText({
      ...baseParams,
      providerOptions,
    })

    // Critical: Detect MAX_TOKENS failure before it silently fails
    if (finishReason === 'length' && (!text || text.trim() === '')) {
      throw new Error(
        `[Critical Failure] Summary generation failed due to MAX_TOKENS. ` +
          `Model consumed all tokens without generating output. ` +
          `maxTokens: ${maxTokens}, fallback: ${fallbackLabel}`,
      )
    }

    const summaryText = text.trim()
    if (!summaryText) {
      throw new Error('Empty summary text returned from model')
    }
    return {
      summaryText,
      tokenCount: usage?.outputTokens ?? null,
      finishReason,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error during summarization'

    if (APICallError.isInstance(error)) {
      const status = error.statusCode ?? 'unknown'
      let providerMessage: string | undefined
      let safetyCategories: string[] | undefined

      if (error.responseBody) {
        try {
          const parsedBody = JSON.parse(error.responseBody)
          if (parsedBody?.error?.message) {
            providerMessage = parsedBody.error.message as string
          }
          const promptFeedback = parsedBody?.promptFeedback
          if (promptFeedback?.safetyRatings) {
            type SafetyRating = { category?: unknown } & Record<string, unknown>
            const ratings: SafetyRating[] = Array.isArray(promptFeedback.safetyRatings)
              ? (promptFeedback.safetyRatings as SafetyRating[])
              : []
            safetyCategories = ratings
              .map((entry: SafetyRating) =>
                entry && typeof entry === 'object' && 'category' in entry
                  ? (entry.category as string | undefined)
                  : undefined,
              )
              .filter((cat): cat is string => Boolean(cat))
          }
        } catch {
          providerMessage = `Unparseable response (${error.responseBody.slice(0, 120)})`
        }
      }

      console.error(
        `[summaries] LLM summary failed (${fallbackLabel}) - ${message} ` +
          `(status: ${status}${providerMessage ? `, provider: ${providerMessage}` : ''}` +
          `${safetyCategories?.length ? `, safety: ${safetyCategories.join(', ')}` : ''})`,
      )
    } else {
      console.error(`[summaries] LLM summary failed (${fallbackLabel}) - ${message}`)
    }

    const fallbackText = fallbackTextFactory()
    return {
      summaryText: fallbackText,
      tokenCount: null,
      finishReason: 'error',
    }
  }
}

async function loadChunkTranscriptMessages({
  supabase,
  chatId,
  startSeq,
  endSeq,
  transcriptMessages,
}: {
  supabase: CreateChunkSummaryOptions['supabase']
  chatId: string
  startSeq: number
  endSeq: number
  transcriptMessages?: MessageTranscriptRow[]
}): Promise<MessageTranscriptRow[]> {
  const transcript =
    transcriptMessages ??
    (
      await loadProjectedConversationMessages({
        supabase,
        chatId,
      })
    ).map((message) => ({
      role: message.role,
      content: message.content,
    }))

  return transcript.slice(startSeq - 1, endSeq)
}

/**
 * Create a chunk summary for a message range
 */
export async function createChunkSummary({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  startSeq,
  endSeq,
  systemPrompt,
  expectedMessageCount = CHUNK_SIZE,
  transcriptMessages,
}: CreateChunkSummaryOptions): Promise<void> {
  let chunkMessages: MessageTranscriptRow[] = []

  try {
    chunkMessages = await loadChunkTranscriptMessages({
      supabase,
      chatId,
      startSeq,
      endSeq,
      transcriptMessages,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to load chunk messages: ${message}`)
  }

  if (typeof expectedMessageCount === 'number' && chunkMessages.length !== expectedMessageCount) {
    throw new Error(
      `Expected ${expectedMessageCount} messages for chunk but received ${chunkMessages.length}`,
    )
  }

  const sanitizedChunk = chunkMessages.map((msg) => ({
    role: msg.role,
    content: truncateText(msg.content, MESSAGE_CHAR_LIMIT),
  })) as MessageTranscriptRow[]

  const formattedTranscript = sanitizedChunk
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join('\n')

  const summaryPromptContent = `Summarize the following conversation segment:\n\n${formattedTranscript}`

  const promptCache = resolvePromptCacheDecision({
    provider,
    modelName,
    systemPrompt,
    messages: [{ role: 'user', content: summaryPromptContent }],
    totalInputTokens: estimateTokenCount(systemPrompt) + estimateTokenCount(summaryPromptContent),
    cacheKeyOverride: provider === 'openai' ? `summary:${chatId}:${startSeq}-${endSeq}` : undefined,
    retentionPreference: '24h',
  })

  const { summaryText, tokenCount } = await generateSummaryWithFallback({
    model,
    provider,
    systemPrompt,
    prompt: summaryPromptContent,
    maxTokens: CHUNK_SUMMARY_MAX_TOKENS,
    fallbackLabel: `chunk ${startSeq}-${endSeq}`,
    fallbackTextFactory: () => buildChunkFallbackSummary(sanitizedChunk),
    promptCache,
  })

  await supabase.from('chat_summaries').insert<ChatSummaryInsert>({
    chat_id: chatId,
    user_id: userId,
    level: SUMMARY_LEVEL_CHUNK,
    start_seq: startSeq,
    end_seq: endSeq,
    summary: summaryText,
    token_count: tokenCount,
  })
}

/**
 * Create facts (episodic memory) for a message range
 */
export async function createChunkFacts({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  startSeq,
  endSeq,
  factPrompt,
  transcriptMessages,
}: CreateChunkFactsOptions): Promise<void> {
  logFactsExtractionDebug('[Facts Extraction] Function called', {
    chatId,
    userId,
    startSeq,
    endSeq,
  })

  logFactsExtractionDebug('[Facts Extraction] Loading messages from database', {
    chatId,
    startSeq,
    endSeq,
  })
  let chunkMessages: MessageTranscriptRow[] = []

  try {
    chunkMessages = await loadChunkTranscriptMessages({
      supabase,
      chatId,
      startSeq,
      endSeq,
      transcriptMessages,
    })
  } catch (error) {
    console.error('[Facts Extraction] Failed to load messages', {
      chatId,
      startSeq,
      endSeq,
      error: error instanceof Error ? error.message : String(error),
    })
    return
  }

  logFactsExtractionDebug('[Facts Extraction] Messages loaded from database', {
    chatId,
    startSeq,
    endSeq,
    messageCount: chunkMessages.length,
    messagesIsNull: false,
    messagesIsArray: true,
  })

  if (chunkMessages.length === 0) {
    logFactsExtractionDebug('[Facts Extraction] No messages found in range - skipping', {
      chatId,
      startSeq,
      endSeq,
    })
    return
  }

  const formattedTranscript = chunkMessages
    .map((msg) => `${msg.role.toUpperCase()}: ${truncateText(msg.content, MESSAGE_CHAR_LIMIT)}`)
    .join('\n')

  logFactsExtractionDebug('[Facts Extraction] Starting fact extraction', {
    chatId,
    startSeq,
    endSeq,
    messageCount: chunkMessages.length,
  })

  logFactsExtractionDebug('[Facts Extraction] LLM input', {
    chatId,
    startSeq,
    endSeq,
    systemPromptLength: factPrompt.length,
    transcriptLength: formattedTranscript.length,
  })

  try {
    // OpenAI GPT-5.1 doesn't support max_tokens, only max_completion_tokens
    const llmConfig = provider === 'openai' ? { temperature: 1 } : DEFAULT_LLM_CONFIG

    const promptCache = resolvePromptCacheDecision({
      provider,
      modelName,
      systemPrompt: factPrompt,
      messages: [{ role: 'user', content: formattedTranscript }],
      totalInputTokens: estimateTokenCount(factPrompt) + estimateTokenCount(formattedTranscript),
      cacheKeyOverride: provider === 'openai' ? `facts:${chatId}:${startSeq}-${endSeq}` : undefined,
      retentionPreference: '24h',
    })

    const providerOptions = getProviderOptions(provider, {
      promptCacheKey: promptCache?.key ?? undefined,
      promptCacheRetention: promptCache?.retention ?? undefined,
    })

    const { text, finishReason } = await generateText({
      model,
      system: factPrompt,
      prompt: formattedTranscript,
      providerOptions,
      ...llmConfig,
    })

    logFactsExtractionDebug('[Facts Extraction] LLM response received', {
      chatId,
      startSeq,
      endSeq,
      finishReason,
      textLength: text.length,
    })

    // Critical: Detect MAX_TOKENS failure
    if (finishReason === 'length' && (!text || text.trim() === '')) {
      throw new Error(
        `[Critical Failure] Fact extraction failed due to MAX_TOKENS. ` +
          `Model consumed all tokens without generating output. ` +
          `maxTokens: ${DEFAULT_LLM_CONFIG.maxTokens}`,
      )
    }

    const rawText = text.trim()

    // Skip if no significant facts
    if (
      rawText.includes('기록할 사실 없음') ||
      rawText.length < 10 ||
      rawText.toLowerCase().includes('no significant facts')
    ) {
      logFactsExtractionDebug('[Facts Extraction] Skipped - no significant facts detected', {
        chatId,
        startSeq,
        endSeq,
        reason: rawText.length < 10 ? 'too_short' : 'explicit_skip_message',
        factsLength: rawText.length,
      })
      return
    }

    // Extract only bullet points
    const bulletLines = rawText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^[-*•]\s+.+/.test(line))

    logFactsExtractionDebug('[Facts Extraction] Parsed bullet points', {
      chatId,
      startSeq,
      endSeq,
      rawTextLength: rawText.length,
      bulletCount: bulletLines.length,
    })

    if (bulletLines.length === 0) {
      logFactsExtractionDebug('[Facts Extraction] Skipped - no bullet points found in LLM output', {
        chatId,
        startSeq,
        endSeq,
        rawTextLength: rawText.length,
      })
      return
    }

    const facts = bulletLines.join('\n')

    logFactsExtractionDebug('[Facts Extraction] Generating embedding', {
      chatId,
      startSeq,
      endSeq,
      factsLength: facts.length,
    })

    const embedding = await generateFactEmbedding(facts, userId, supabase)

    logFactsExtractionDebug('[Facts Extraction] Storing facts to database', {
      chatId,
      startSeq,
      endSeq,
      hasEmbedding: !!embedding,
    })

    const { error: insertError } = await supabase.from('chat_facts').insert({
      chat_id: chatId,
      user_id: userId,
      start_seq: startSeq,
      end_seq: endSeq,
      facts,
      embedding,
    })

    if (insertError) {
      throw new Error(`Failed to insert facts: ${insertError.message}`)
    }

    logFactsExtractionDebug('[Facts Extraction] Successfully stored facts', {
      chatId,
      startSeq,
      endSeq,
      factsLength: facts.length,
      hasEmbedding: !!embedding,
    })
  } catch (error) {
    console.error('[Facts Extraction] Failed to extract/store facts', {
      chatId,
      startSeq,
      endSeq,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
    })
    // Don't throw - fact extraction failure shouldn't block summary generation
  }
}

/**
 * Process all pending chunk summaries for a chat
 */
export async function processChunkSummaries({
  supabase,
  chatId,
  userId,
  model,
  provider,
  modelName,
  totalMessages,
  previousEnd,
  chunkPrompt,
  factPrompt,
}: ProcessChunkOptions): Promise<void> {
  const boundaries = calculateChunkBoundaries(totalMessages, previousEnd, CHUNK_SIZE)

  if (boundaries.length === 0) {
    return
  }

  // Race condition prevention: check for existing chunks in a single query
  const { data: existingChunks } = await supabase
    .from('chat_summaries')
    .select('start_seq, end_seq')
    .eq('chat_id', chatId)
    .eq('level', SUMMARY_LEVEL_CHUNK)
    .in(
      'start_seq',
      boundaries.map((b) => b.start),
    )

  const existingSet = new Set(existingChunks?.map((c) => c.start_seq) ?? [])
  const toCreate = boundaries.filter((b) => !existingSet.has(b.start))
  const transcriptMessages = (
    await loadProjectedConversationMessages({
      supabase,
      chatId,
    })
  ).map((message) => ({
    role: message.role,
    content: message.content,
  }))

  for (const boundary of toCreate) {
    try {
      // Create chunk summary (semantic memory)
      await createChunkSummary({
        supabase,
        chatId,
        userId,
        model,
        provider,
        modelName,
        startSeq: boundary.start,
        endSeq: boundary.end,
        systemPrompt: chunkPrompt,
        transcriptMessages,
      })

      // Extract facts (episodic memory)
      await createChunkFacts({
        supabase,
        chatId,
        userId,
        model,
        provider,
        modelName,
        startSeq: boundary.start,
        endSeq: boundary.end,
        factPrompt,
        transcriptMessages,
      })
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        continue
      } else {
        console.error('Failed to create chunk summary:', error)
        return
      }
    }
  }
}
