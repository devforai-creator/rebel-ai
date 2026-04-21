import { createAdminClient } from '@/lib/supabase/admin'
import { streamText } from 'ai'
import { isGoogleExplicitCacheToolConflict, normalizeProviderError } from '@/lib/llm/provider-error'
import {
  CHAT_JOB_LIFECYCLE_STAGE_CONTENT_FILTERED,
  CHAT_JOB_LIFECYCLE_STAGE_EMPTY_RESPONSE,
  CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR,
} from '@/lib/chat/job-lifecycle'
import type { LlmProvider } from '@/types/database.types'
import {
  broadcastAssistantStreamError,
  broadcastAssistantStreamSnapshot,
} from './assistant-stream-broadcaster'
import { evaluateContentFilter } from './content-filter'
import { ChatJobExecutionError } from './runner-errors'
import type { UsageMetrics } from './usage-debug'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type ProviderTextStream = Awaited<ReturnType<typeof streamText>>
type DebugMetricValue = string | number | boolean | null

function buildProviderStreamExecutionError({
  provider,
  error,
  streamedTextLength,
}: {
  provider: LlmProvider
  error: unknown
  streamedTextLength: number
}) {
  const normalizedError = normalizeProviderError({
    provider,
    error,
  })

  return new ChatJobExecutionError(
    normalizedError.userMessage,
    CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR,
    {
      normalizedProviderError: normalizedError,
      streamedTextLength,
      googleExplicitCacheToolConflict:
        provider === 'google' &&
        streamedTextLength === 0 &&
        isGoogleExplicitCacheToolConflict(error),
    },
  )
}

export type StreamingResponseStageResult = {
  fullText: string
  assistantText: string
  finishReason: Awaited<ProviderTextStream['finishReason']>
  anthropicCacheCreationInputTokens: number | null
  usage: UsageMetrics
}

async function collectTextFromStreamWithSnapshots({
  supabase,
  chatId,
  jobId,
  stream,
  provider,
  regenerateAssistantMessageId,
  debugMetrics,
  updateIntervalMs = 120,
  now = () => performance.now(),
}: {
  supabase: AdminSupabaseClient
  chatId: string
  jobId: string
  stream: ProviderTextStream
  provider: LlmProvider
  regenerateAssistantMessageId: string | null
  debugMetrics?: Record<string, DebugMetricValue>
  updateIntervalMs?: number
  now?: () => number
}) {
  let fullText = ''
  let lastBroadcastAt = now()
  let sendInFlight: Promise<void> | null = null
  let queuedContent: string | null = null
  let lastSentContent = ''

  const sendSnapshot = (content: string) => {
    if (content === lastSentContent) {
      return
    }

    if (sendInFlight) {
      queuedContent = content
      return
    }

    const snapshot = content
    sendInFlight = broadcastAssistantStreamSnapshot({
      supabase,
      chatId,
      jobId,
      content: snapshot,
      regenerateAssistantMessageId,
    }).finally(() => {
      lastSentContent = snapshot
      sendInFlight = null

      if (queuedContent && queuedContent !== lastSentContent) {
        const nextContent = queuedContent
        queuedContent = null
        sendSnapshot(nextContent)
        return
      }

      queuedContent = null
    })
  }

  const flushSnapshots = async () => {
    while (sendInFlight) {
      await sendInFlight
    }
  }

  try {
    if (stream.fullStream) {
      for await (const part of stream.fullStream) {
        if (provider === 'anthropic' && debugMetrics) {
          if (part.type === 'reasoning-start') {
            debugMetrics['anthropic_thinking_block_seen'] = true
          }

          if (part.type === 'reasoning-delta') {
            const currentCount =
              typeof debugMetrics['anthropic_reasoning_delta_count'] === 'number'
                ? debugMetrics['anthropic_reasoning_delta_count']
                : 0
            debugMetrics['anthropic_reasoning_delta_count'] = currentCount + 1

            const providerMetadata =
              part.providerMetadata?.anthropic &&
              typeof part.providerMetadata.anthropic === 'object'
                ? (part.providerMetadata.anthropic as Record<string, unknown>)
                : null
            if (typeof providerMetadata?.signature === 'string' && providerMetadata.signature) {
              debugMetrics['anthropic_signature_delta_seen'] = true
            }
          }
        }

        if (part.type === 'text-delta' && typeof part.text === 'string') {
          fullText += part.text

          const currentTime = now()
          if (currentTime - lastBroadcastAt >= updateIntervalMs) {
            sendSnapshot(fullText)
            lastBroadcastAt = currentTime
          }
        }

        if (part.type === 'error') {
          throw buildProviderStreamExecutionError({
            provider,
            error: part.error,
            streamedTextLength: fullText.length,
          })
        }
      }
    } else {
      for await (const chunk of stream.textStream) {
        fullText += chunk

        const currentTime = now()
        if (currentTime - lastBroadcastAt >= updateIntervalMs) {
          sendSnapshot(fullText)
          lastBroadcastAt = currentTime
        }
      }
    }
  } catch (error) {
    if (error instanceof ChatJobExecutionError) {
      throw error
    }

    throw buildProviderStreamExecutionError({
      provider,
      error,
      streamedTextLength: fullText.length,
    })
  }

  if (fullText) {
    sendSnapshot(fullText)
    await flushSnapshots()
  }

  return fullText
}

export async function consumeStreamingResponseStage({
  supabase,
  chatId,
  jobId,
  stream,
  provider,
  regenerateAssistantMessageId,
  debugMetrics,
  logDebug = () => undefined,
  updateIntervalMs,
  now,
  allowGoogleExplicitCacheRecovery,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  jobId: string
  stream: ProviderTextStream
  provider: LlmProvider
  regenerateAssistantMessageId: string | null
  debugMetrics?: Record<string, DebugMetricValue>
  logDebug?: (...args: unknown[]) => void
  updateIntervalMs?: number
  now?: () => number
  allowGoogleExplicitCacheRecovery?: boolean
}): Promise<StreamingResponseStageResult> {
  let fullText = ''

  try {
    fullText = await collectTextFromStreamWithSnapshots({
      supabase,
      chatId,
      jobId,
      stream,
      provider,
      regenerateAssistantMessageId,
      debugMetrics,
      updateIntervalMs,
      now,
    })
  } catch (error) {
    const streamError =
      error instanceof ChatJobExecutionError
        ? error
        : new ChatJobExecutionError(
            error instanceof Error ? error.message : String(error),
            CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR,
          )
    const shouldSuppressBroadcast =
      allowGoogleExplicitCacheRecovery === true &&
      streamError.lifecycleStage === CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR &&
      streamError.details?.googleExplicitCacheToolConflict === true &&
      (streamError.details?.streamedTextLength ?? 0) === 0

    if (!shouldSuppressBroadcast) {
      await broadcastAssistantStreamError({
        supabase,
        chatId,
        jobId,
        error: streamError.message,
        regenerateAssistantMessageId,
      })
    }
    throw streamError
  }

  const finishReason = await stream.finishReason
  const providerMetadata = await stream.providerMetadata

  const anthropicProviderMetadata =
    provider === 'anthropic' &&
    providerMetadata?.anthropic &&
    typeof providerMetadata.anthropic === 'object'
      ? (providerMetadata.anthropic as Record<string, unknown>)
      : null
  const anthropicRawUsage = anthropicProviderMetadata?.usage as Record<string, number> | undefined
  const anthropicCacheCreationInputTokens =
    typeof anthropicProviderMetadata?.cacheCreationInputTokens === 'number'
      ? anthropicProviderMetadata.cacheCreationInputTokens
      : (anthropicRawUsage?.cache_creation_input_tokens ?? null)

  if (anthropicRawUsage) {
    logDebug('[Chat Job Runner] Anthropic cache metrics', {
      cacheRead: anthropicRawUsage.cache_read_input_tokens ?? 0,
      cacheCreation: anthropicCacheCreationInputTokens ?? 0,
      uncached: anthropicRawUsage.input_tokens ?? 0,
    })
  }

  const contentFilterInfo = evaluateContentFilter({
    provider,
    finishReason,
    metadata: providerMetadata,
  })

  const assistantText = fullText.trim()

  if (!assistantText) {
    if (contentFilterInfo.blocked) {
      throw new ChatJobExecutionError(
        'Blocked by Google Gemini content filter. Please disable safe mode or refine your input and try again.',
        CHAT_JOB_LIFECYCLE_STAGE_CONTENT_FILTERED,
      )
    }

    if (finishReason === 'error') {
      throw new ChatJobExecutionError(
        'The provider returned an error before producing text. Please try again later.',
        CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR,
      )
    }

    throw new ChatJobExecutionError(
      'The assistant returned an empty response. Please try again later.',
      CHAT_JOB_LIFECYCLE_STAGE_EMPTY_RESPONSE,
    )
  }

  const usage = await stream.usage
  if (provider === 'anthropic' && debugMetrics) {
    const thinkingBlockSeen = debugMetrics['anthropic_thinking_block_seen'] === true
    const signatureDeltaSeen = debugMetrics['anthropic_signature_delta_seen'] === true
    const reasoningDeltaCount =
      typeof debugMetrics['anthropic_reasoning_delta_count'] === 'number'
        ? debugMetrics['anthropic_reasoning_delta_count']
        : null
    debugMetrics['anthropic_reasoning_tokens_reported'] = usage?.reasoningTokens ?? null
    debugMetrics['anthropic_thinking_used'] =
      typeof usage?.reasoningTokens === 'number'
        ? usage.reasoningTokens > 0
        : thinkingBlockSeen || signatureDeltaSeen || reasoningDeltaCount !== null
  }

  return {
    fullText,
    assistantText,
    finishReason,
    anthropicCacheCreationInputTokens,
    usage: {
      promptTokens: usage?.inputTokens ?? null,
      completionTokens: usage?.outputTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      cachedInputTokens: usage?.cachedInputTokens ?? null,
      reasoningTokens: usage?.reasoningTokens ?? null,
    },
  }
}
