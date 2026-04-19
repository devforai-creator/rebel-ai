import { createAdminClient } from '@/lib/supabase/admin'
import { streamText } from 'ai'
import { normalizeProviderError } from '@/lib/llm/provider-error'
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
  updateIntervalMs = 120,
  now = () => performance.now(),
}: {
  supabase: AdminSupabaseClient
  chatId: string
  jobId: string
  stream: ProviderTextStream
  provider: LlmProvider
  regenerateAssistantMessageId: string | null
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
        if (part.type === 'text-delta' && typeof part.text === 'string') {
          fullText += part.text

          const currentTime = now()
          if (currentTime - lastBroadcastAt >= updateIntervalMs) {
            sendSnapshot(fullText)
            lastBroadcastAt = currentTime
          }
        }

        if (part.type === 'error') {
          const normalizedError = normalizeProviderError({
            provider,
            error: part.error,
          })
          throw new ChatJobExecutionError(
            normalizedError.userMessage,
            CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR,
          )
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

    const normalizedError = normalizeProviderError({
      provider,
      error,
    })
    throw new ChatJobExecutionError(
      normalizedError.userMessage,
      CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR,
    )
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
  logDebug = () => undefined,
  updateIntervalMs,
  now,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  jobId: string
  stream: ProviderTextStream
  provider: LlmProvider
  regenerateAssistantMessageId: string | null
  logDebug?: (...args: unknown[]) => void
  updateIntervalMs?: number
  now?: () => number
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
    await broadcastAssistantStreamError({
      supabase,
      chatId,
      jobId,
      error: streamError.message,
      regenerateAssistantMessageId,
    })
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
