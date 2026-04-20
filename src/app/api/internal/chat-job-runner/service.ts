import { createAdminClient } from '@/lib/supabase/admin'
import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { claimPendingJob } from '@/lib/chat/job-queue'
import { resolveInternalApiOrigin } from '@/lib/internal-api-origin'
import {
  CHAT_JOB_LIFECYCLE_STAGE_LOADING_CONTEXT,
  CHAT_JOB_LIFECYCLE_STAGE_POST_PROCESSING,
  CHAT_JOB_LIFECYCLE_STAGE_REQUESTING_PROVIDER,
  CHAT_JOB_LIFECYCLE_STAGE_STREAMING_RESPONSE,
  type ChatJobLifecycleStage,
} from '@/lib/chat/job-lifecycle'
import { persistChatJobLifecycleStage } from '@/lib/chat/job-lifecycle-store'
import { pollDueAnthropicBatchJobs } from './anthropic-batch-orchestrator'
import { loadChatJobExecutionContext } from './execution-context'
import { runPostProcessingStage } from './post-processing-stage'
import { processChatJobStage, type ProcessChatJobExecutionResult } from './process-job-stage'
import { requestProviderStage } from './provider-request-stage'
import { ChatJobExecutionError } from './runner-errors'
import { consumeStreamingResponseStage } from './streaming-response-stage'

const CHAT_JOB_RUNNER_DEBUG_ENABLED = process.env.CHAT_JOB_RUNNER_DEBUG === 'true'
type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type DebugMetricValue = string | number | boolean | null

function logChatJobRunnerDebug(...args: unknown[]): void {
  if (CHAT_JOB_RUNNER_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function formatTimingsForDebug(timings: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(timings)
      .map(([key, value]) => [key, Math.round(value)] as const)
      .sort(([a], [b]) => a.localeCompare(b)),
  )
}

function formatMetricsForDebug(
  metrics: Record<string, DebugMetricValue>,
): Record<string, DebugMetricValue> {
  return Object.fromEntries(
    Object.entries(metrics)
      .map(([key, value]) => [
        key,
        typeof value === 'number' ? Math.round(value * 100) / 100 : value,
      ])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  )
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
    const claimMetrics: Record<string, DebugMetricValue> = {}
    const claimStart = performance.now()
    const job = await claimPendingJob(supabase, {
      onMetrics(metrics) {
        claimMetrics['queue_fetch_ms'] = metrics.fetchDurationMs
        claimMetrics['queue_update_ms'] = metrics.updateDurationMs
        claimMetrics['queue_fetched_pending_row'] = metrics.fetchedPendingRow
        claimMetrics['queue_claimed'] = metrics.claimed
      },
    })
    const claimDurationMs = performance.now() - claimStart

    logChatJobRunnerDebug('[Chat Job Runner] Queue claim result', {
      iteration: index + 1,
      jobId: job?.id ?? null,
      metrics: formatMetricsForDebug({
        ...claimMetrics,
        queue_claim_total_ms: claimDurationMs,
      }),
    })

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
  const { chatId, userId, provider } = payload

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
      agenticTranscriptRecall,
      agenticTranscriptRecallSourceHints,
      agenticTranscriptRecallSourceMap,
      bilingualEnabled,
      anthropicConversationMessages,
      anthropicPlaceholderAdded,
      totalInputTokens,
      staticPromptTokens,
      debugMetrics,
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
        agenticTranscriptRecall,
        agenticTranscriptRecallSourceHints,
        agenticTranscriptRecallSourceMap,
        bilingualEnabled,
        anthropicConversationMessages,
        anthropicPlaceholderAdded,
        totalInputTokens,
        staticPromptTokens,
        debugMetrics,
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
    timings['8_llm_generation'] = performance.now() - stepStart

    await markStage(CHAT_JOB_LIFECYCLE_STAGE_POST_PROCESSING)
    const postGenerationResult = await runPostProcessingStage({
      supabase,
      payload,
      origin,
      context: {
        apiKeyData,
        generationTranscript,
        finalSystemPrompt,
        dynamicContext,
        dynamicContextTokens,
        recentMessages,
        ragInfo,
        bilingualEnabled,
        anthropicConversationMessages,
        anthropicPlaceholderAdded,
        totalInputTokens,
        staticPromptTokens,
        debugMetrics,
      },
      providerArtifacts: {
        promptCache,
        anthropicCache,
        googleExplicitCacheEnabled,
        googleCacheDecision,
        googleCacheResult,
        actualPayload,
      },
      streamingResponse,
    })

    if (postGenerationResult.messageInsertDuration !== null) {
      timings['9_message_insert'] = postGenerationResult.messageInsertDuration
    }
    timings['10_usage_event_insert'] = postGenerationResult.usageEventInsertDurationMs
    timings['11_summary_trigger'] = postGenerationResult.summaryTriggerDurationMs

    const totalTime = performance.now() - startTime
    timings['00_total'] = totalTime

    logChatJobRunnerDebug('[Chat Job Runner] Performance timings (ms)', {
      chatId,
      requestId: payload.requestId,
      timings: formatTimingsForDebug(timings),
    })

    logChatJobRunnerDebug('[Chat Job Runner] Context metrics', {
      chatId,
      requestId: payload.requestId,
      metrics: formatMetricsForDebug(debugMetrics),
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
