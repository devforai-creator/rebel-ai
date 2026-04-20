import type { Database, LlmProvider } from '@/types/database.types'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import type { UsageCostBreakdown } from '@/lib/model-pricing'
import type { PromptCacheDecision, AnthropicCacheDecision } from '@/lib/llm/prompt-cache'
import type { CreateGoogleCacheResult } from '@/lib/llm/google-cache'

type ConversationMessage = { role: string; content: string }
type DebugMetricValue = string | number | boolean | null

export type ChatRunnerActualPayload = {
  provider: LlmProvider
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
  anthropicCacheCreationInputTokens: number | null
  anthropicCacheReadInputTokens: number | null
  staticPromptTokens: number
  dynamicContext: string | null
  dynamicContextTokens: number
  googleExplicitCacheEnabled: boolean
  googleCacheResult: CreateGoogleCacheResult | null
  googleCacheDecision: { enabled: boolean; minTokens: number | null } | null
  rawResponse: string
  processedResponse: string
  apiKeyId: string
  provider: LlmProvider
  modelName: string
  finishReason?: string | null
  usage: UsageMetrics
  sanitizedMessageCount: number
  ragInfo: unknown
  actualPayload: ChatRunnerActualPayload | null
  debugMetrics?: Record<string, DebugMetricValue>
}

type AgenticTranscriptRecallDebugInfo = {
  configured: boolean | null
  globallyEnabled: boolean | null
  providerSupported: boolean | null
  providerAllowed: boolean | null
  enabled: boolean | null
  skipReason: string | null
  sourceHintCount: number | null
  wrapperUsed: boolean | null
  fallbackToStandard: boolean | null
  toolAvailable: boolean | null
  expandAvailable: boolean | null
  expandCallCount: number | null
  expandLastParentStartSeq: number | null
  expandLastParentEndSeq: number | null
  expandLastReason: string | null
  expandLastBlockReason: string | null
  expandLastChildRangeCount: number | null
  toolCallCount: number | null
  toolFetchCount: number | null
  toolBlockCount: number | null
  toolTotalMessagesFetched: number | null
  toolLastStartSeq: number | null
  toolLastEndSeq: number | null
  toolLastReason: string | null
  toolLastBlockReason: string | null
  stepCount: number | null
}

type AnthropicThinkingDebugInfo = {
  requested: boolean | null
  type: string | null
  effort: string | null
  interleavedThinkingBetaRequested: boolean | null
  reasoningTokensReported: number | null
  used: boolean | null
}

type BuildChatUsageEventArgs = {
  userId: string
  chatId: string
  apiKeyId: string
  provider: LlmProvider
  modelName: string
  usage: UsageMetrics
  usageCost: UsageCostBreakdown | null
  requestId: string
}

function readBooleanMetric(
  metrics: Record<string, DebugMetricValue> | undefined,
  key: string,
): boolean | null {
  const value = metrics?.[key]
  return typeof value === 'boolean' ? value : null
}

function readNumberMetric(
  metrics: Record<string, DebugMetricValue> | undefined,
  key: string,
): number | null {
  const value = metrics?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readStringMetric(
  metrics: Record<string, DebugMetricValue> | undefined,
  key: string,
): string | null {
  const value = metrics?.[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

function buildExperimentalAgenticTranscriptRecallDebugInfo(
  debugMetrics: Record<string, DebugMetricValue> | undefined,
): AgenticTranscriptRecallDebugInfo | null {
  if (!debugMetrics) {
    return null
  }

  const configured = readBooleanMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_configured',
  )
  const globallyEnabled = readBooleanMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_globally_enabled',
  )
  const providerSupported = readBooleanMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_provider_supported',
  )
  const providerAllowed = readBooleanMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_provider_allowed',
  )
  const enabled = readBooleanMetric(debugMetrics, 'experimental_agentic_transcript_recall_enabled')
  const skipReason = readStringMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_skip_reason',
  )
  const sourceHintCount = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_source_hint_count',
  )
  const wrapperUsed = readBooleanMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_wrapper_used',
  )
  const fallbackToStandard = readBooleanMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_fallback_to_standard',
  )
  const toolAvailable = readBooleanMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_available',
  )
  const expandAvailable = readBooleanMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_expand_available',
  )
  const expandCallCount = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_expand_call_count',
  )
  const expandLastParentStartSeq = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_expand_last_parent_start_seq',
  )
  const expandLastParentEndSeq = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_expand_last_parent_end_seq',
  )
  const expandLastReason = readStringMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_expand_last_reason',
  )
  const expandLastBlockReason = readStringMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_expand_last_block_reason',
  )
  const expandLastChildRangeCount = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_expand_last_child_range_count',
  )
  const toolCallCount = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_call_count',
  )
  const toolFetchCount = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_fetch_count',
  )
  const toolBlockCount = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_block_count',
  )
  const toolTotalMessagesFetched = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_total_messages_fetched',
  )
  const toolLastStartSeq = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_last_start_seq',
  )
  const toolLastEndSeq = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_last_end_seq',
  )
  const toolLastReason = readStringMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_last_reason',
  )
  const toolLastBlockReason = readStringMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_tool_last_block_reason',
  )
  const stepCount = readNumberMetric(
    debugMetrics,
    'experimental_agentic_transcript_recall_step_count',
  )

  const hasAnyValue = [
    configured,
    globallyEnabled,
    providerSupported,
    providerAllowed,
    enabled,
    skipReason,
    sourceHintCount,
    wrapperUsed,
    fallbackToStandard,
    toolAvailable,
    expandAvailable,
    expandCallCount,
    expandLastParentStartSeq,
    expandLastParentEndSeq,
    expandLastReason,
    expandLastBlockReason,
    expandLastChildRangeCount,
    toolCallCount,
    toolFetchCount,
    toolBlockCount,
    toolTotalMessagesFetched,
    toolLastStartSeq,
    toolLastEndSeq,
    toolLastReason,
    toolLastBlockReason,
    stepCount,
  ].some((value) => value !== null)

  if (!hasAnyValue) {
    return null
  }

  return {
    configured,
    globallyEnabled,
    providerSupported,
    providerAllowed,
    enabled,
    skipReason,
    sourceHintCount,
    wrapperUsed,
    fallbackToStandard,
    toolAvailable,
    expandAvailable,
    expandCallCount,
    expandLastParentStartSeq,
    expandLastParentEndSeq,
    expandLastReason,
    expandLastBlockReason,
    expandLastChildRangeCount,
    toolCallCount,
    toolFetchCount,
    toolBlockCount,
    toolTotalMessagesFetched,
    toolLastStartSeq,
    toolLastEndSeq,
    toolLastReason,
    toolLastBlockReason,
    stepCount,
  }
}

function buildAnthropicThinkingDebugInfo(
  debugMetrics: Record<string, DebugMetricValue> | undefined,
): AnthropicThinkingDebugInfo | null {
  if (!debugMetrics) {
    return null
  }

  const requested = readBooleanMetric(debugMetrics, 'anthropic_thinking_requested')
  const type = readStringMetric(debugMetrics, 'anthropic_thinking_type')
  const effort = readStringMetric(debugMetrics, 'anthropic_thinking_effort')
  const interleavedThinkingBetaRequested = readBooleanMetric(
    debugMetrics,
    'anthropic_interleaved_thinking_requested',
  )
  const reasoningTokensReported = readNumberMetric(
    debugMetrics,
    'anthropic_reasoning_tokens_reported',
  )
  const used = readBooleanMetric(debugMetrics, 'anthropic_thinking_used')

  const hasAnyValue = [
    requested,
    type,
    effort,
    interleavedThinkingBetaRequested,
    reasoningTokensReported,
    used,
  ].some((value) => value !== null)

  if (!hasAnyValue) {
    return null
  }

  return {
    requested,
    type,
    effort,
    interleavedThinkingBetaRequested,
    reasoningTokensReported,
    used,
  }
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
    anthropicCacheCreationInputTokens,
    anthropicCacheReadInputTokens,
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
    debugMetrics,
  } = args

  const experimentalAgenticTranscriptRecall =
    buildExperimentalAgenticTranscriptRecallDebugInfo(debugMetrics)
  const anthropicThinking = buildAnthropicThinkingDebugInfo(debugMetrics)

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
          minTokens: anthropicCache.minTokens,
          staticPromptTokens,
          estimatedMeetsMinTokens: staticPromptTokens >= anthropicCache.minTokens,
          cachedSystemTokens: staticPromptTokens,
          dynamicContextTokens: dynamicContext ? dynamicContextTokens : 0,
          cacheCreationInputTokens: anthropicCacheCreationInputTokens,
          cacheReadInputTokens: anthropicCacheReadInputTokens,
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
    anthropicThinking,
    systemPromptLength: finalSystemPrompt.length,
    sanitizedMessageCount,
    rag: ragInfo,
    actualPayload,
    experimental:
      experimentalAgenticTranscriptRecall === null
        ? null
        : {
            agenticTranscriptRecall: experimentalAgenticTranscriptRecall,
          },
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
