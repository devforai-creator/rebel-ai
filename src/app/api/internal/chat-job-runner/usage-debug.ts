import type { Database } from '@/types/database.types'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import type { UsageCostBreakdown } from '@/lib/model-pricing'
import type { PromptCacheDecision, AnthropicCacheDecision } from '@/lib/llm/prompt-cache'
import type { CreateGoogleCacheResult } from '@/lib/llm/google-cache'

type ConversationMessage = { role: string; content: string }

export type ChatRunnerActualPayload = {
  provider: string
  strategy: 'anthropic-split-system' | 'google-explicit-cache' | 'default'
  systemMessages: Array<{ role: string; content: string; cached?: boolean }>
  conversationMessages: Array<{ role: string; content: string }>
  cache?: {
    systemPrompt?: string
    cacheName?: string
    cachedTokenCount?: number
    messagesToCache?: Array<{ role: string; content: string }>
  }
}

export type UsageMetrics = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
}

type BuildChatDebugInfoArgs = {
  requestId: string
  finalSystemPrompt: string
  recentMessages: SanitizedMessage[]
  anthropicConversationMessages: ConversationMessage[] | null
  anthropicPlaceholderAdded: boolean
  promptCache: PromptCacheDecision | null
  totalInputTokens: number
  anthropicCache: AnthropicCacheDecision | null
  staticPromptTokens: number
  dynamicContext: string | null
  dynamicContextTokens: number
  googleExplicitCacheEnabled: boolean
  googleCacheResult: CreateGoogleCacheResult | null
  googleCacheDecision: { enabled: boolean; minTokens: number | null } | null
  rawResponse: string
  processedResponse: string
  apiKeyId: string
  provider: string
  modelName: string
  finishReason?: string | null
  usage: UsageMetrics
  sanitizedMessageCount: number
  ragInfo: unknown
  actualPayload: ChatRunnerActualPayload | null
}

type BuildChatUsageEventArgs = {
  userId: string
  chatId: string
  apiKeyId: string
  provider: string
  modelName: string
  usage: UsageMetrics
  usageCost: UsageCostBreakdown | null
  requestId: string
}

export function buildChatDebugInfo(args: BuildChatDebugInfoArgs): Record<string, unknown> {
  const {
    requestId,
    finalSystemPrompt,
    recentMessages,
    anthropicConversationMessages,
    anthropicPlaceholderAdded,
    promptCache,
    totalInputTokens,
    anthropicCache,
    staticPromptTokens,
    dynamicContext,
    dynamicContextTokens,
    googleExplicitCacheEnabled,
    googleCacheResult,
    googleCacheDecision,
    rawResponse,
    processedResponse,
    apiKeyId,
    provider,
    modelName,
    finishReason,
    usage,
    sanitizedMessageCount,
    ragInfo,
    actualPayload,
  } = args

  return {
    requestId,
    timestamp: new Date().toISOString(),
    fullPrompt: {
      system: finalSystemPrompt,
      messages: recentMessages,
      anthropicConversationMessages,
      anthropicPlaceholderAdded,
    },
    promptCache: promptCache
      ? {
          key: promptCache.key,
          retention: promptCache.retention,
          totalInputTokens,
        }
      : null,
    anthropicCache: anthropicCache
      ? {
          enabled: anthropicCache.enabled,
          ttl: anthropicCache.ttl,
          staticPromptTokens,
          cachedSystemTokens: staticPromptTokens,
          dynamicContextTokens: dynamicContext ? dynamicContextTokens : 0,
        }
      : null,
    googleCache: {
      featureEnabled: googleExplicitCacheEnabled,
      cacheCreated: googleCacheResult?.success ?? false,
      cacheName: googleCacheResult?.success ? googleCacheResult.cacheName : null,
      cachedTokenCount: googleCacheResult?.success ? googleCacheResult.cachedTokenCount : 0,
      expireTime: googleCacheResult?.success ? googleCacheResult.expireTime : null,
      actualTtl: googleCacheResult?.success ? googleCacheResult.ttl : null,
      error: googleCacheResult && !googleCacheResult.success ? googleCacheResult.error : null,
      minTokens: googleCacheDecision?.minTokens ?? null,
      meetsMinTokens: googleCacheDecision?.enabled ?? false,
    },
    rawResponse,
    processedResponse,
    cacheHit: usage.cachedInputTokens !== null && usage.cachedInputTokens > 0,
    modelConfig: {
      apiKeyId,
      provider,
      modelName,
      finishReason: finishReason ?? null,
      usage: {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
        cachedInputTokens: usage.cachedInputTokens,
        reasoningTokens: usage.reasoningTokens,
      },
    },
    systemPromptLength: finalSystemPrompt.length,
    sanitizedMessageCount,
    rag: ragInfo,
    actualPayload,
  }
}

export function buildChatUsageEvent({
  userId,
  chatId,
  apiKeyId,
  provider,
  modelName,
  usage,
  usageCost,
  requestId,
}: BuildChatUsageEventArgs): Database['public']['Tables']['chat_usage_events']['Insert'] {
  return {
    user_id: userId,
    chat_id: chatId,
    api_key_id: apiKeyId,
    model_provider: provider,
    model_name: modelName,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    cached_input_tokens: usage.cachedInputTokens,
    reasoning_tokens: usage.reasoningTokens,
    prompt_cost_usd: usageCost?.promptCost ?? 0,
    cached_input_cost_usd: usageCost?.cachedInputCost ?? 0,
    completion_cost_usd: usageCost?.completionCost ?? 0,
    reasoning_cost_usd: usageCost?.reasoningCost ?? 0,
    total_cost_usd: usageCost?.totalCost ?? 0,
    request_id: requestId,
  }
}

export function appendSummaryWarningToDebugInfo(
  debugInfo: Record<string, unknown>,
  {
    error,
    attempts,
  }: {
    error?: string
    attempts?: number
  },
): Record<string, unknown> {
  return {
    ...debugInfo,
    summaryWarning: {
      error,
      attempts,
      timestamp: new Date().toISOString(),
    },
  }
}
