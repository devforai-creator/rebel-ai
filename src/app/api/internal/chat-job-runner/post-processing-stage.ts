import { createAdminClient } from '@/lib/supabase/admin'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { type UsageCostBreakdown, estimateUsageCost } from '@/lib/model-pricing'
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

function buildUsageCost({
  payload,
  serviceTier,
  usage,
}: {
  payload: ChatGenerationJobPayload
  serviceTier: PostProcessingContext['apiKeyData']['service_tier']
  usage: UsageMetrics
}): UsageCostBreakdown | null {
  return estimateUsageCost({
    provider: payload.provider,
    modelName: payload.modelName,
    promptTokens: usage.promptTokens ?? undefined,
    completionTokens: usage.completionTokens ?? undefined,
    cachedInputTokens: usage.cachedInputTokens ?? undefined,
    reasoningTokens: usage.reasoningTokens ?? undefined,
    serviceTier: serviceTier ?? undefined,
  })
}

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
  }
  const usageCost = buildUsageCost({
    payload,
    serviceTier: apiKeyData.service_tier,
    usage: usageMetrics,
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
