import { createAdminClient } from '@/lib/supabase/admin'
import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { claimPendingJob } from '@/lib/chat/job-queue'
import { estimateUsageCost } from '@/lib/model-pricing'
import { resolveInternalApiOrigin } from '@/lib/internal-api-origin'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import {
  CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT,
  CHAT_JOB_LIFECYCLE_STAGE_POST_PROCESSING,
  CHAT_JOB_LIFECYCLE_STAGE_PERSISTING_RESPONSE,
  CHAT_JOB_LIFECYCLE_STAGE_REQUESTING_PROVIDER,
  CHAT_JOB_LIFECYCLE_STAGE_STREAMING_RESPONSE,
  type ChatJobLifecycleStage,
} from '@/lib/chat/job-lifecycle'
import { persistChatJobLifecycleStage } from '@/lib/chat/job-lifecycle-store'
import { buildChatDebugInfo } from './usage-debug'
import { runPostGenerationPipeline } from './post-generation-pipeline'
import { pollDueAnthropicBatchJobs } from './anthropic-batch-orchestrator'
import { loadChatJobExecutionContext } from './execution-context'
import { processChatJobStage, type ProcessChatJobExecutionResult } from './process-job-stage'
import { requestProviderStage } from './provider-request-stage'
import { ChatJobExecutionError } from './runner-errors'
import { consumeStreamingResponseStage } from './streaming-response-stage'

const CHAT_JOB_RUNNER_DEBUG_ENABLED = process.env.CHAT_JOB_RUNNER_DEBUG === 'true'
type AdminSupabaseClient = ReturnType<typeof createAdminClient>

function logChatJobRunnerDebug(...args: unknown[]): void {
  if (CHAT_JOB_RUNNER_DEBUG_ENABLED) {
    console.debug(...args)
  }
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

    const result = await processChatJobStage({
      supabase,
      jobId: job.id,
      rawPayload: job.payload,
      origin,
      executeChatJobFn: executeJob,
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
}): Promise<ProcessChatJobExecutionResult> {
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
    const streamingResponse = await consumeStreamingResponseStage({
      supabase,
      chatId,
      jobId,
      stream,
      provider,
      regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
      logDebug: logChatJobRunnerDebug,
    })
    const { fullText, assistantText, finishReason, anthropicCacheCreationInputTokens, usage } =
      streamingResponse
    let assistantMessageId: string | null = null
    let messageInsertDuration: number | null = null

    timings['8_llm_generation'] = performance.now() - stepStart
    const promptTokens = usage.promptTokens
    const completionTokens = usage.completionTokens
    const totalTokens = usage.totalTokens
    const cachedInputTokens = usage.cachedInputTokens
    const reasoningTokens = usage.reasoningTokens
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
