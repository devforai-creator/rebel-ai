import { createAdminClient } from '@/lib/supabase/admin'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { CHAT_JOB_LIFECYCLE_STAGE_PERSISTING_RESPONSE } from '@/lib/chat/job-lifecycle'
import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import type { LoadedChatJobExecutionContext } from './execution-context'
import {
  runPostGenerationPipeline,
  type PostGenerationPipelineResult,
} from './post-generation-pipeline'
import type { ProviderRequestStageResult } from './provider-request-stage'
import { ChatJobExecutionError } from './runner-errors'
import type { StreamingResponseStageResult } from './streaming-response-stage'
import { buildChatDebugInfo, type UsageMetrics } from './usage-debug'
import { resolveCacheWriteUsage } from '@/lib/chat/cache-write-usage'
import { buildUsageReceipt } from '@/lib/chat/usage-receipt'
import {
  priceUsageSteps,
  summarizeUsageServiceTier,
  sumReportedUsageCost,
  sumUsageSteps,
} from '@/lib/llm/usage'
import { getDeepSeekPricingPeriod, summarizeDeepSeekPricingPeriods } from '@/lib/deepseek/pricing'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>

type PostProcessingContext = Pick<
  LoadedChatJobExecutionContext,
  | 'apiKeyData'
  | 'generationTranscript'
  | 'finalSystemPrompt'
  | 'dynamicContext'
  | 'dynamicContextTokens'
  | 'recentMessages'
  | 'ragInfo'
  | 'bilingualEnabled'
  | 'anthropicConversationMessages'
  | 'anthropicPlaceholderAdded'
  | 'totalInputTokens'
  | 'staticPromptTokens'
  | 'debugMetrics'
>

type ProviderRequestArtifacts = Pick<
  ProviderRequestStageResult,
  | 'promptCache'
  | 'anthropicCache'
  | 'googleExplicitCacheEnabled'
  | 'googleCacheDecision'
  | 'googleCacheResult'
  | 'actualPayload'
>

export type PostProcessingStageResult = Pick<
  PostGenerationPipelineResult,
  'messageInsertDuration' | 'usageEventInsertDurationMs' | 'summaryTriggerDurationMs'
>

function normalizePersistingResponseError(error: unknown): ChatJobExecutionError {
  if (error instanceof ChatJobExecutionError) {
    return error
  }

  return new ChatJobExecutionError(
    error instanceof Error ? error.message : String(error),
    CHAT_JOB_LIFECYCLE_STAGE_PERSISTING_RESPONSE,
  )
}

export async function runPostProcessingStage({
  supabase,
  payload,
  origin,
  context,
  providerArtifacts,
  streamingResponse,
}: {
  supabase: AdminSupabaseClient
  payload: ChatGenerationJobPayload
  origin: string
  context: PostProcessingContext
  providerArtifacts: ProviderRequestArtifacts
  streamingResponse: StreamingResponseStageResult
}): Promise<PostProcessingStageResult> {
  const {
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
  } = context
  const {
    promptCache,
    anthropicCache,
    googleExplicitCacheEnabled,
    googleCacheDecision,
    googleCacheResult,
    actualPayload,
  } = providerArtifacts
  const { fullText, assistantText, finishReason, anthropicCacheCreationInputTokens, usage } =
    streamingResponse

  const usageMetrics: UsageMetrics = {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
    ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
  }
  const serviceTier =
    (payload.provider === 'google' ? payload.serviceTier : apiKeyData.service_tier) ?? 'standard'
  let usageSteps = streamingResponse.usageSteps ?? [
    {
      ...usageMetrics,
      ...(payload.provider === 'anthropic' && anthropicCacheCreationInputTokens !== null
        ? { cacheWriteTokens: anthropicCacheCreationInputTokens }
        : {}),
      ...(streamingResponse.serviceTier ? { serviceTier: streamingResponse.serviceTier } : {}),
    },
  ]
  if (payload.provider === 'anthropic') {
    usageSteps = usageSteps.map((step) => ({
      ...step,
      ...resolveCacheWriteUsage(step, anthropicCache?.ttl),
    }))
    Object.assign(usageMetrics, sumUsageSteps(usageSteps))
  }
  const reportedCostUsd =
    payload.provider === 'openrouter' ? sumReportedUsageCost(usageSteps) : null
  if (payload.provider === 'openrouter') usageMetrics.reportedCostUsd = reportedCostUsd
  const usageCost =
    reportedCostUsd !== null
      ? null
      : priceUsageSteps({
          steps: usageSteps,
          provider: payload.provider,
          modelName: payload.modelName,
          serviceTier,
          cacheWriteTtl: anthropicCache?.ttl,
        })
  const debugConversationMessages =
    payload.provider === 'anthropic' ? anthropicConversationMessages : null
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
    anthropicCacheReadInputTokens: usage.cachedInputTokens,
    staticPromptTokens,
    dynamicContext,
    dynamicContextTokens,
    googleExplicitCacheEnabled,
    googleCacheResult,
    googleCacheDecision,
    rawResponse: fullText,
    processedResponse: assistantText,
    apiKeyId: payload.apiKeyId,
    provider: payload.provider,
    modelName: payload.modelName,
    finishReason,
    usage: usageMetrics,
    sanitizedMessageCount: generationTranscript.length,
    ragInfo,
    actualPayload,
    debugMetrics,
  })
  debugInfo.usageReceipt = buildUsageReceipt({
    requestId: payload.requestId,
    provider: payload.provider,
    modelName: payload.modelName,
    usage: usageMetrics,
    cost: usageCost,
    cacheWriteTtl: anthropicCache?.ttl,
    callCount: usageSteps.length,
    ...(payload.provider === 'deepseek' || payload.provider === 'openrouter'
      ? {
          ...(payload.provider === 'deepseek'
            ? {
                pricingPeriod: summarizeDeepSeekPricingPeriods(
                  usageSteps.map((step) => getDeepSeekPricingPeriod(step.pricingTimestamp)),
                ),
              }
            : {}),
          billingModels: [
            ...new Set(usageSteps.flatMap((step) => (step.modelName ? [step.modelName] : []))),
          ],
        }
      : {}),
    ...(payload.provider === 'google' || payload.provider === 'openai'
      ? { serviceTier: summarizeUsageServiceTier(usageSteps, serviceTier) }
      : {}),
  })

  try {
    const postGenerationResult = await runPostGenerationPipeline({
      supabase,
      chatId: payload.chatId,
      userId: payload.userId,
      apiKeyId: payload.apiKeyId,
      provider: payload.provider,
      modelName: payload.modelName,
      origin,
      requestId: payload.requestId,
      assistantText,
      assistantMessageId: null,
      turnId: payload.turnId,
      regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      debugInfo,
      bilingualEnabled,
      messageInsertDuration: null,
      usage: usageMetrics,
      usageCost,
      triggerMessageTranslationFn: triggerMessageTranslation,
    })

    return {
      messageInsertDuration: postGenerationResult.messageInsertDuration,
      usageEventInsertDurationMs: postGenerationResult.usageEventInsertDurationMs,
      summaryTriggerDurationMs: postGenerationResult.summaryTriggerDurationMs,
    }
  } catch (error) {
    throw normalizePersistingResponseError(error)
  }
}
