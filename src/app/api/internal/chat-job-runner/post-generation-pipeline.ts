import type { createAdminClient } from '@/lib/supabase/admin'
import type { UsageCostBreakdown } from '@/lib/model-pricing'
import type { Json, LlmProvider, MessageUpdate } from '@/types/database.types'
import {
  resolveSummaryModelPreference,
  type SummaryModelConfig,
} from '@/lib/chat/summary-model-preference'
import { triggerSummaryGeneration, type TriggerResult } from '@/lib/chat/summary-trigger'
import { appendSummaryWarningToDebugInfo, type UsageMetrics } from './usage-debug'
import { finalizeAssistantMessage } from './assistant-finalization'
import {
  clearStaleAssistantDebugInfo,
  recordPostGenerationMetadata,
} from './post-generation-metadata'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>

type ResolveSummaryModelPreferenceFn = (args: {
  supabase: AdminSupabaseClient
  userId: string
}) => Promise<SummaryModelConfig | null>

type TriggerSummaryGenerationFn = (args: {
  origin: string
  chatId: string
  userId: string
  provider: LlmProvider
  modelName: string
  apiKeyId: string
}) => Promise<TriggerResult>

type TriggerMessageTranslationFn = (assistantMessageId: string, userId: string) => void

type RunPostGenerationPipelineArgs = {
  supabase: AdminSupabaseClient
  chatId: string
  userId: string
  apiKeyId: string
  provider: LlmProvider
  modelName: string
  origin: string
  requestId: string
  assistantText: string
  assistantMessageId: string | null
  turnId: string | null
  regenerateAssistantMessageId: string | null
  promptTokens: number | null
  completionTokens: number | null
  debugInfo: Record<string, unknown>
  bilingualEnabled: boolean
  messageInsertDuration: number | null
  usage: UsageMetrics
  usageCost: UsageCostBreakdown | null
  triggerMessageTranslationFn: TriggerMessageTranslationFn
  resolveSummaryModelPreferenceFn?: ResolveSummaryModelPreferenceFn
  triggerSummaryGenerationFn?: TriggerSummaryGenerationFn
  now?: () => number
}

export type PostGenerationPipelineResult = {
  assistantMessageId: string
  messageInsertDuration: number | null
  usageEventInsertDurationMs: number
  summaryTriggerDurationMs: number
}

const CHAT_JOB_RUNNER_DEBUG_ENABLED = process.env.CHAT_JOB_RUNNER_DEBUG === 'true'

function logPostGenerationDebug(...args: unknown[]): void {
  if (CHAT_JOB_RUNNER_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function scheduleSummaryGeneration({
  supabase,
  chatId,
  userId,
  apiKeyId,
  provider,
  modelName,
  origin,
  assistantMessageId,
  debugInfo,
  resolveSummaryModelPreferenceFn,
  triggerSummaryGenerationFn,
  now,
}: {
  supabase: AdminSupabaseClient
  chatId: string
  userId: string
  apiKeyId: string
  provider: LlmProvider
  modelName: string
  origin: string
  assistantMessageId: string
  debugInfo: Record<string, unknown>
  resolveSummaryModelPreferenceFn: ResolveSummaryModelPreferenceFn
  triggerSummaryGenerationFn: TriggerSummaryGenerationFn
  now: () => number
}): void {
  void (async () => {
    const summaryTriggerStart = now()
    let summaryFailure: { error: string; attempts?: number } | null = null

    try {
      const summaryPreference = await resolveSummaryModelPreferenceFn({ supabase, userId })
      const summaryConfig = summaryPreference ?? { provider, modelName, apiKeyId }

      if (summaryPreference) {
        logPostGenerationDebug('[Chat Job Runner] Using summary-specific model', {
          chatId,
          provider: summaryPreference.provider,
          modelName: summaryPreference.modelName,
        })
      }

      const summaryResult = await triggerSummaryGenerationFn({
        origin,
        chatId,
        userId,
        provider: summaryConfig.provider,
        modelName: summaryConfig.modelName,
        apiKeyId: summaryConfig.apiKeyId,
      })

      const summaryTriggerDurationMs = now() - summaryTriggerStart
      logPostGenerationDebug('[Chat Job Runner] Summary trigger finished', {
        chatId,
        userId,
        durationMs: summaryTriggerDurationMs,
        success: summaryResult.success,
        attempts: summaryResult.attempts,
      })

      if (!summaryResult.success) {
        summaryFailure = {
          error: summaryResult.error ?? 'Unknown summary trigger failure',
          attempts: summaryResult.attempts,
        }
        console.warn('[Chat Job Runner] Summary generation trigger failed', {
          chatId,
          userId,
          error: summaryResult.error,
          attempts: summaryResult.attempts,
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown summary trigger failure'
      summaryFailure = { error: message }
      console.error('[Chat Job Runner] Summary generation background task failed', {
        chatId,
        userId,
        error,
      })
    }

    if (!summaryFailure) {
      return
    }

    const summaryWarningUpdate: MessageUpdate = {
      debug_info: appendSummaryWarningToDebugInfo(debugInfo, summaryFailure) as Json,
    }
    const { error: summaryWarningError } = await supabase
      .from('messages')
      .update(summaryWarningUpdate as never)
      .eq('id', assistantMessageId)
      .eq('chat_id', chatId)

    if (summaryWarningError) {
      console.warn('[Chat Job Runner] Failed to persist summary warning', {
        chatId,
        userId,
        assistantMessageId,
        error: summaryWarningError.message,
      })
    }
  })()
}

export async function runPostGenerationPipeline({
  supabase,
  chatId,
  userId,
  apiKeyId,
  provider,
  modelName,
  origin,
  requestId,
  assistantText,
  assistantMessageId,
  turnId,
  regenerateAssistantMessageId,
  promptTokens,
  completionTokens,
  debugInfo,
  bilingualEnabled,
  messageInsertDuration,
  usage,
  usageCost,
  triggerMessageTranslationFn,
  resolveSummaryModelPreferenceFn = resolveSummaryModelPreference,
  triggerSummaryGenerationFn = triggerSummaryGeneration,
  now = () => performance.now(),
}: RunPostGenerationPipelineArgs): Promise<PostGenerationPipelineResult> {
  const {
    assistantMessageId: finalAssistantMessageId,
    messageInsertDuration: finalMessageInsertDuration,
  } = await finalizeAssistantMessage({
    supabase,
    chatId,
    userId,
    assistantText,
    assistantMessageId,
    turnId,
    regenerateAssistantMessageId,
    promptTokens,
    completionTokens,
    debugInfo,
    modelName,
    messageInsertDuration,
    now,
  })

  // Only the newest assistant message keeps server-side debug_info for this chat.
  await clearStaleAssistantDebugInfo({
    supabase,
    chatId,
    userId,
    apiKeyId,
    requestId,
    retainedAssistantMessageId: finalAssistantMessageId,
  })

  if (bilingualEnabled) {
    triggerMessageTranslationFn(finalAssistantMessageId, userId)
  }

  const { usageEventInsertDurationMs } = await recordPostGenerationMetadata({
    supabase,
    chatId,
    userId,
    apiKeyId,
    provider,
    modelName,
    requestId,
    usage,
    usageCost,
    now,
  })

  // Summary generation is best-effort and should not block the chat worker.
  scheduleSummaryGeneration({
    supabase,
    chatId,
    userId,
    apiKeyId,
    provider,
    modelName,
    origin,
    assistantMessageId: finalAssistantMessageId,
    debugInfo,
    resolveSummaryModelPreferenceFn,
    triggerSummaryGenerationFn,
    now,
  })

  return {
    assistantMessageId: finalAssistantMessageId,
    messageInsertDuration: finalMessageInsertDuration,
    usageEventInsertDurationMs,
    summaryTriggerDurationMs: 0,
  }
}
