import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.types'
import { parseChatJobPayload, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { claimPendingJob } from '@/lib/chat/job-queue'
import { estimateUsageCost } from '@/lib/model-pricing'
import { resolveInternalApiOrigin } from '@/lib/internal-api-origin'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { normalizeProviderError } from '@/lib/llm/provider-error'
import {
  CHAT_JOB_LIFECYCLE_STAGE_COMPLETED,
  CHAT_JOB_LIFECYCLE_STAGE_CONTENT_FILTERED,
  CHAT_JOB_LIFECYCLE_STAGE_EMPTY_RESPONSE,
  CHAT_JOB_LIFECYCLE_STAGE_INVALID_PAYLOAD,
  CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT,
  CHAT_JOB_LIFECYCLE_STAGE_POST_PROCESSING,
  CHAT_JOB_LIFECYCLE_STAGE_PERSISTING_RESPONSE,
  CHAT_JOB_LIFECYCLE_STAGE_PROVIDER_STREAM_ERROR,
  CHAT_JOB_LIFECYCLE_STAGE_REQUESTING_PROVIDER,
  CHAT_JOB_LIFECYCLE_STAGE_STREAMING_RESPONSE,
  type ChatJobLifecycleStage,
} from '@/lib/chat/job-lifecycle'
import { persistChatJobLifecycleStage } from '@/lib/chat/job-lifecycle-store'
import { evaluateContentFilter } from './content-filter'
import { buildChatDebugInfo } from './usage-debug'
import { runPostGenerationPipeline } from './post-generation-pipeline'
import { pollDueAnthropicBatchJobs } from './anthropic-batch-orchestrator'
import {
  broadcastAssistantStreamError,
  broadcastAssistantStreamSnapshot,
} from './assistant-stream-broadcaster'
import { loadChatJobExecutionContext } from './execution-context'
import { requestProviderStage } from './provider-request-stage'

const CHAT_JOB_RUNNER_DEBUG_ENABLED = process.env.CHAT_JOB_RUNNER_DEBUG === 'true'
const CHAT_JOB_STATUS_UPDATE_MAX_ATTEMPTS = 3
type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type ChatGenerationJobUpdate = Database['public']['Tables']['chat_generation_jobs']['Update']

function logChatJobRunnerDebug(...args: unknown[]): void {
  if (CHAT_JOB_RUNNER_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

class ChatJobStatusUpdateError extends Error {
  targetStatus: 'success' | 'error'

  constructor(targetStatus: 'success' | 'error', attempts: number, message: string) {
    super(
      `Failed to persist chat job ${targetStatus} status after ${attempts} attempts: ${message}`,
    )
    this.name = 'ChatJobStatusUpdateError'
    this.targetStatus = targetStatus
  }
}

class ChatJobExecutionError extends Error {
  lifecycleStage: ChatJobLifecycleStage

  constructor(message: string, lifecycleStage: ChatJobLifecycleStage) {
    super(message)
    this.name = 'ChatJobExecutionError'
    this.lifecycleStage = lifecycleStage
  }
}

async function persistTerminalJobStatus({
  supabase,
  jobId,
  update,
  targetStatus,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  update: ChatGenerationJobUpdate
  targetStatus: 'success' | 'error'
}): Promise<void> {
  let lastError: { message: string } | null = null

  for (let attempt = 1; attempt <= CHAT_JOB_STATUS_UPDATE_MAX_ATTEMPTS; attempt += 1) {
    const { error } = await supabase
      .from('chat_generation_jobs')
      .update(update as never)
      .eq('id', jobId)

    if (!error) {
      return
    }

    lastError = error
    console.warn('[Chat Job Runner] Failed to persist job status', {
      jobId,
      status: targetStatus,
      attempt,
      error: error.message,
    })
  }

  throw new ChatJobStatusUpdateError(
    targetStatus,
    CHAT_JOB_STATUS_UPDATE_MAX_ATTEMPTS,
    lastError?.message ?? 'Unknown database error',
  )
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
  stream: {
    textStream: AsyncIterable<string> | Iterable<string>
    fullStream?:
      | AsyncIterable<{ type: string; text?: string; error?: unknown }>
      | Iterable<{
          type: string
          text?: string
          error?: unknown
        }>
  }
  provider: string
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

export async function processChatJobs(limit: number = 1) {
  const supabase = createAdminClient()
  const processed: Array<{ jobId: string; status: string; error?: string }> = []
  const origin = resolveInternalApiOrigin()

  // Ensure limit is reasonable
  const jobLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5) : 1

  const batchResults = await pollDueAnthropicBatchJobs({ supabase, origin, limit: jobLimit })
  processed.push(...batchResults)

  for (let index = 0; index < jobLimit; index += 1) {
    const job = await claimPendingJob(supabase)
    if (!job) {
      break
    }

    const result = await processJob({
      supabase,
      jobId: job.id,
      rawPayload: job.payload,
      origin,
    })

    processed.push(result)
    if (result.status === 'error') {
      // continue processing other jobs but log for visibility
      console.warn('[Chat Job Runner] Job failed', {
        jobId: result.jobId,
        error: result.error,
      })
    }
  }

  return {
    processedCount: processed.length,
    results: processed,
  }
}

async function processJob({
  supabase,
  jobId,
  rawPayload,
  origin,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  rawPayload: unknown
  origin: string
}): Promise<{ jobId: string; status: string; error?: string }> {
  const payload = parseChatJobPayload(rawPayload)

  if (!payload) {
    const invalidPayloadMessage = 'Invalid job payload'
    const invalidPayloadUpdate: ChatGenerationJobUpdate = {
      status: 'error',
      error: invalidPayloadMessage,
      lifecycle_stage: CHAT_JOB_LIFECYCLE_STAGE_INVALID_PAYLOAD,
      failure_stage: CHAT_JOB_LIFECYCLE_STAGE_INVALID_PAYLOAD,
    }

    try {
      await persistTerminalJobStatus({
        supabase,
        jobId,
        update: invalidPayloadUpdate,
        targetStatus: 'error',
      })
    } catch (statusError) {
      console.error('[Chat Job Runner] Failed to persist invalid job payload status', {
        jobId,
        error: statusError,
      })
      return {
        jobId,
        status: 'error',
        error: statusError instanceof Error ? statusError.message : invalidPayloadMessage,
      }
    }

    return { jobId, status: 'error', error: invalidPayloadMessage }
  }

  try {
    const execution = await executeJob({ supabase, jobId, payload, origin })

    if (execution.status === 'processing') {
      return { jobId, status: 'processing' }
    }

    const successUpdate: ChatGenerationJobUpdate = {
      status: 'success',
      error: null,
      lifecycle_stage: CHAT_JOB_LIFECYCLE_STAGE_COMPLETED,
      failure_stage: null,
    }
    await persistTerminalJobStatus({
      supabase,
      jobId,
      update: successUpdate,
      targetStatus: 'success',
    })

    return { jobId, status: 'success' }
  } catch (error) {
    if (error instanceof ChatJobStatusUpdateError && error.targetStatus === 'success') {
      console.error('[Chat Job Runner] Job completed but final status update failed', {
        jobId,
        error,
      })
      return { jobId, status: 'error', error: error.message }
    }

    const message = error instanceof Error ? error.message : 'Unknown job failure'
    const failureStage =
      error instanceof ChatJobExecutionError
        ? error.lifecycleStage
        : CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT
    const errorUpdate: ChatGenerationJobUpdate = {
      status: 'error',
      error: message,
      lifecycle_stage: failureStage,
      failure_stage: failureStage,
    }

    try {
      await persistTerminalJobStatus({
        supabase,
        jobId,
        update: errorUpdate,
        targetStatus: 'error',
      })
    } catch (statusError) {
      console.error('[Chat Job Runner] Failed to persist job error status', {
        jobId,
        error: statusError,
        originalError: error,
      })
      return {
        jobId,
        status: 'error',
        error:
          statusError instanceof Error
            ? `${statusError.message}. Original job error: ${message}`
            : message,
      }
    }

    console.error('[Chat Job Runner] Job failed', { jobId, error })
    return { jobId, status: 'error', error: message }
  }
}

async function executeJob({
  supabase,
  jobId,
  payload,
  origin,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  payload: ChatGenerationJobPayload
  origin: string
}): Promise<{ status: 'success' | 'processing' }> {
  const { chatId, userId, apiKeyId, provider, modelName } = payload

  const timings: Record<string, number> = {}
  const startTime = performance.now()
  let stepStart = startTime

  logChatJobRunnerDebug('[Chat Job Runner] Executing job', {
    chatId,
    userId,
    requestId: payload.requestId,
    vercelEnv: process.env.VERCEL_ENV,
    vercelUrl: process.env.VERCEL_URL,
    origin,
  })

  let currentStage: ChatJobLifecycleStage = CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT
  const markStage = async (stage: ChatJobLifecycleStage) => {
    currentStage = stage
    await persistChatJobLifecycleStage({
      supabase,
      jobId,
      stage,
      additionalUpdate: {
        failure_stage: null,
      },
    })
  }

  try {
    await markStage(CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT)

    const {
      apiKeyData,
      decryptedApiKey,
      generationTranscript,
      finalSystemPrompt,
      staticSystemPrompt,
      dynamicContext,
      dynamicContextTokens,
      promptBlocks,
      recentMessages,
      ragInfo,
      bilingualEnabled,
      anthropicConversationMessages,
      anthropicPlaceholderAdded,
      totalInputTokens,
      staticPromptTokens,
    } = await loadChatJobExecutionContext({
      supabase,
      payload,
      timings,
    })

    await markStage(CHAT_JOB_LIFECYCLE_STAGE_REQUESTING_PROVIDER)
    stepStart = performance.now()
    const providerRequest = await requestProviderStage({
      supabase,
      jobId,
      payload,
      context: {
        apiKeyData,
        decryptedApiKey,
        generationTranscript,
        finalSystemPrompt,
        staticSystemPrompt,
        dynamicContext,
        dynamicContextTokens,
        promptBlocks,
        recentMessages,
        ragInfo,
        bilingualEnabled,
        anthropicConversationMessages,
        anthropicPlaceholderAdded,
        totalInputTokens,
        staticPromptTokens,
      },
      timings,
      logDebug: logChatJobRunnerDebug,
    })

    if (providerRequest.status === 'processing') {
      return { status: 'processing' }
    }

    const {
      stream,
      promptCache,
      anthropicCache,
      googleExplicitCacheEnabled,
      googleCacheDecision,
      googleCacheResult,
      actualPayload,
    } = providerRequest

    await markStage(CHAT_JOB_LIFECYCLE_STAGE_STREAMING_RESPONSE)
    let fullText = ''
    try {
      fullText = await collectTextFromStreamWithSnapshots({
        supabase,
        chatId,
        jobId,
        stream,
        provider,
        regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
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
        regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
      })
      throw streamError
    }
    let assistantMessageId: string | null = null
    let messageInsertDuration: number | null = null

    const finishReason = await stream.finishReason
    const providerMetadata = await stream.providerMetadata
    timings['8_llm_generation'] = performance.now() - stepStart

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

    // Log Anthropic cache metrics
    if (anthropicRawUsage) {
      logChatJobRunnerDebug('[Chat Job Runner] Anthropic cache metrics', {
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
    const promptTokens = usage?.inputTokens ?? null
    const completionTokens = usage?.outputTokens ?? null
    const totalTokens = usage?.totalTokens ?? null
    const cachedInputTokens = usage?.cachedInputTokens ?? null
    const reasoningTokens = usage?.reasoningTokens ?? null
    const usageCost = estimateUsageCost({
      provider,
      modelName,
      promptTokens: promptTokens ?? undefined,
      completionTokens: completionTokens ?? undefined,
      cachedInputTokens: cachedInputTokens ?? undefined,
      reasoningTokens: reasoningTokens ?? undefined,
      serviceTier: apiKeyData.service_tier,
    })

    // For Anthropic debug: show the actual conversation messages sent (with placeholder if added)
    // For other providers: show injected blocks and messages separately
    const debugConversationMessages =
      provider === 'anthropic' ? anthropicConversationMessages : null
    const usageMetrics = {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedInputTokens,
      reasoningTokens,
    }

    const debugInfo = buildChatDebugInfo({
      requestId: payload.requestId,
      finalSystemPrompt,
      recentMessages,
      anthropicConversationMessages: debugConversationMessages,
      anthropicPlaceholderAdded,
      promptCache,
      totalInputTokens,
      anthropicCache,
      anthropicCacheCreationInputTokens,
      anthropicCacheReadInputTokens: cachedInputTokens,
      staticPromptTokens,
      dynamicContext,
      dynamicContextTokens,
      googleExplicitCacheEnabled,
      googleCacheResult,
      googleCacheDecision,
      rawResponse: fullText,
      processedResponse: assistantText,
      apiKeyId,
      provider,
      modelName,
      finishReason,
      usage: usageMetrics,
      sanitizedMessageCount: generationTranscript.length,
      ragInfo,
      actualPayload,
    })

    await markStage(CHAT_JOB_LIFECYCLE_STAGE_POST_PROCESSING)
    currentStage = CHAT_JOB_LIFECYCLE_STAGE_PERSISTING_RESPONSE
    const postGenerationResult = await runPostGenerationPipeline({
      supabase,
      chatId,
      userId,
      apiKeyId,
      provider,
      modelName,
      origin,
      requestId: payload.requestId,
      assistantText,
      assistantMessageId,
      turnId: payload.turnId,
      regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
      promptTokens,
      completionTokens,
      debugInfo,
      bilingualEnabled,
      messageInsertDuration,
      usage: usageMetrics,
      usageCost,
      triggerMessageTranslationFn: triggerMessageTranslation,
    })

    assistantMessageId = postGenerationResult.assistantMessageId
    messageInsertDuration = postGenerationResult.messageInsertDuration

    if (messageInsertDuration !== null) {
      timings['9_message_insert'] = messageInsertDuration
    }
    timings['10_usage_event_insert'] = postGenerationResult.usageEventInsertDurationMs
    timings['11_summary_trigger'] = postGenerationResult.summaryTriggerDurationMs

    const totalTime = performance.now() - startTime
    timings['00_total'] = totalTime

    logChatJobRunnerDebug('[Chat Job Runner] Performance timings (ms)', {
      chatId,
      requestId: payload.requestId,
      timings: Object.fromEntries(
        Object.entries(timings)
          .map(([key, value]) => [key, Math.round(value)] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    })

    return { status: 'success' }
  } catch (error) {
    if (error instanceof ChatJobExecutionError) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'Unknown job failure'
    throw new ChatJobExecutionError(message, currentStage)
  }
}

export { pollAnthropicBatchJobForUser } from './anthropic-batch-orchestrator'
