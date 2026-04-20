import type { createAdminClient } from '@/lib/supabase/admin'
import type { UsageCostBreakdown } from '@/lib/model-pricing'
import type { LlmProvider } from '@/types/database.types'
import type { UsageMetrics } from './usage-debug'
import { finalizeAssistantMessage } from './assistant-finalization'
import {
  dispatchPostGenerationFollowups,
  type ResolveSummaryModelPreferenceFn,
  type TriggerMessageTranslationFn,
  type TriggerSummaryGenerationFn,
} from './post-generation-followups'
import {
  clearStaleAssistantDebugInfo,
  recordPostGenerationMetadata,
} from './post-generation-metadata'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>

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
  resolveSummaryModelPreferenceFn,
  triggerSummaryGenerationFn,
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

  dispatchPostGenerationFollowups({
    supabase,
    chatId,
    userId,
    apiKeyId,
    provider,
    modelName,
    origin,
    assistantMessageId: finalAssistantMessageId,
    debugInfo,
    bilingualEnabled,
    triggerMessageTranslationFn,
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
