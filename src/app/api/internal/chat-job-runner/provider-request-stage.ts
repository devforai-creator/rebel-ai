import { createAdminClient } from '@/lib/supabase/admin'
import { streamText } from 'ai'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'
import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH } from '@/lib/chat/delivery-mode'
import { ANTHROPIC_INTERLEAVED_THINKING_BETA, getProviderOptions } from '@/lib/llm/provider-options'
import { resolveInvocationSamplingOptions } from '@/lib/llm/invocation-sampling'
import { normalizeProviderError } from '@/lib/llm/provider-error'
import {
  resolveAnthropicCacheDecision,
  resolvePromptCacheDecision,
  type AnthropicCacheDecision,
  type PromptCacheDecision,
} from '@/lib/llm/prompt-cache'
import { prepareExperimentalAgenticTranscriptRecallRequest } from '@/lib/experimental/agentic-transcript-recall/runner'
import { buildAgenticTranscriptRecallToolContract } from '@/lib/experimental/agentic-transcript-recall/tool-contract'
import { decideAgenticTranscriptRecallToolChoice } from '@/lib/experimental/agentic-transcript-recall/tool-choice-gate'
import { submitAnthropicBatchJob } from './anthropic-batch-orchestrator'
import type { LoadedChatJobExecutionContext } from './execution-context'
import {
  prepareGoogleExplicitCache,
  type GoogleExplicitCachePreparation,
} from './google-explicit-cache-adapter'
import { buildLanguageModel } from './model-factory'
import { buildStreamPayloadPlan } from './stream-payload-builder'
import type { ChatRunnerActualPayload } from './usage-debug'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type ExperimentalPrepareStep = NonNullable<
  NonNullable<
    ReturnType<typeof prepareExperimentalAgenticTranscriptRecallRequest>['streamTextSettings']
  >['prepareStep']
>
type DebugMetricValue = string | number | boolean | null

type AnthropicThinkingDebugMetricSnapshot = {
  requested: boolean | null
  type: string | null
  effort: string | null
  interleavedThinkingRequested: boolean | null
  disabledForRequiredToolChoice: boolean | null
}

function willExperimentalAgenticTranscriptRecallAttachTools({
  sourceHints,
  sourceMap,
}: {
  sourceHints: LoadedChatJobExecutionContext['agenticTranscriptRecallSourceHints']
  sourceMap: LoadedChatJobExecutionContext['agenticTranscriptRecallSourceMap']
}): boolean {
  const hasRecallHints = !!sourceHints && sourceHints.hints.length > 0
  const hasToolCapableSourceMap =
    !!sourceMap &&
    (sourceMap.directFetchRanges.length > 0 || sourceMap.navigationParents.length > 0)

  if (!hasRecallHints && !hasToolCapableSourceMap) {
    return false
  }

  // In this request stage, ATR is the only path that can attach tools to the provider invocation.
  return hasToolCapableSourceMap
}

type ProviderRequestArtifacts = {
  promptCache: PromptCacheDecision | null
  anthropicCache: AnthropicCacheDecision | null
  googleExplicitCacheEnabled: GoogleExplicitCachePreparation['googleExplicitCacheEnabled']
  googleCacheDecision: GoogleExplicitCachePreparation['googleCacheDecision']
  googleCacheResult: GoogleExplicitCachePreparation['googleCacheResult']
  actualPayload: ChatRunnerActualPayload | null
}

export type ProviderRequestStageResult =
  | ({
      status: 'processing'
    } & ProviderRequestArtifacts)
  | ({
      status: 'streaming'
      stream: Awaited<ReturnType<typeof streamText>>
    } & ProviderRequestArtifacts)

function disableAnthropicThinkingForRequiredToolChoice(
  providerOptions: SharedV2ProviderOptions | undefined,
): {
  providerOptions: SharedV2ProviderOptions | undefined
  disabled: boolean
} {
  const anthropicOptions =
    providerOptions?.anthropic && typeof providerOptions.anthropic === 'object'
      ? ({ ...(providerOptions.anthropic as Record<string, unknown>) } as Record<string, unknown>)
      : null

  if (!anthropicOptions) {
    return {
      providerOptions,
      disabled: false,
    }
  }

  let disabled = false

  if (Object.prototype.hasOwnProperty.call(anthropicOptions, 'thinking')) {
    delete anthropicOptions.thinking
    disabled = true
  }

  if (Object.prototype.hasOwnProperty.call(anthropicOptions, 'effort')) {
    delete anthropicOptions.effort
    disabled = true
  }

  if (Array.isArray(anthropicOptions.anthropicBeta)) {
    const filteredBetas = anthropicOptions.anthropicBeta.filter(
      (value) => value !== ANTHROPIC_INTERLEAVED_THINKING_BETA,
    )

    if (filteredBetas.length !== anthropicOptions.anthropicBeta.length) {
      disabled = true
    }

    if (filteredBetas.length > 0) {
      anthropicOptions.anthropicBeta = filteredBetas
    } else {
      delete anthropicOptions.anthropicBeta
    }
  }

  if (!disabled) {
    return {
      providerOptions,
      disabled: false,
    }
  }

  const nextProviderOptions: Record<string, unknown> = {
    ...(providerOptions ?? {}),
  }

  if (Object.keys(anthropicOptions).length > 0) {
    nextProviderOptions.anthropic = anthropicOptions
  } else {
    delete nextProviderOptions.anthropic
  }

  return {
    providerOptions:
      Object.keys(nextProviderOptions).length > 0
        ? (nextProviderOptions as SharedV2ProviderOptions)
        : undefined,
    disabled: true,
  }
}

function findLastMessageContent(
  messages: Array<{ role: string; content: string }>,
  role: 'assistant' | 'user',
): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== role) {
      continue
    }

    const content = message.content.trim()
    if (content.length > 0) {
      return content
    }
  }

  return null
}

function applyAnthropicThinkingDebugMetrics({
  debugMetrics,
  snapshot,
}: {
  debugMetrics: Record<string, DebugMetricValue>
  snapshot: AnthropicThinkingDebugMetricSnapshot
}): void {
  debugMetrics['anthropic_thinking_requested'] = snapshot.requested
  debugMetrics['anthropic_thinking_type'] = snapshot.type
  debugMetrics['anthropic_thinking_effort'] = snapshot.effort
  debugMetrics['anthropic_interleaved_thinking_requested'] = snapshot.interleavedThinkingRequested
  debugMetrics['anthropic_thinking_disabled_for_required_tool_choice'] =
    snapshot.disabledForRequiredToolChoice
}

function buildRequiredFirstToolStepOverride(
  existingPrepareStep?: ExperimentalPrepareStep,
): ExperimentalPrepareStep {
  return async (options) => {
    const existingResult = await existingPrepareStep?.(options)

    return {
      ...existingResult,
      toolChoice: options.stepNumber === 0 ? ('required' as const) : ('auto' as const),
    }
  }
}

export async function requestProviderStage({
  supabase,
  jobId,
  payload,
  context,
  timings,
  logDebug = () => undefined,
  disableGoogleExplicitCache = false,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  payload: ChatGenerationJobPayload
  context: LoadedChatJobExecutionContext
  timings: Record<string, number>
  logDebug?: (...args: unknown[]) => void
  disableGoogleExplicitCache?: boolean
}): Promise<ProviderRequestStageResult> {
  const { provider, modelName } = payload
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
  } = context

  const chatCacheKeyOverride = provider === 'openai' ? `chat:${payload.chatId}` : undefined
  const promptCache = resolvePromptCacheDecision({
    provider,
    modelName,
    systemPrompt: finalSystemPrompt,
    messages: recentMessages,
    totalInputTokens,
    cacheKeyOverride: chatCacheKeyOverride,
    retentionPreference: chatCacheKeyOverride ? '24h' : undefined,
  })
  const anthropicCache =
    provider === 'anthropic'
      ? resolveAnthropicCacheDecision({
          modelName,
        })
      : null

  const hasOlderSourceHints =
    !!agenticTranscriptRecallSourceHints && agenticTranscriptRecallSourceHints.hints.length > 0
  const hasToolCapableSourceMap = willExperimentalAgenticTranscriptRecallAttachTools({
    sourceHints: agenticTranscriptRecallSourceHints,
    sourceMap: agenticTranscriptRecallSourceMap,
  })
  const atrToolChoiceDecision = agenticTranscriptRecall.enabled
    ? decideAgenticTranscriptRecallToolChoice({
        lastUserMessage: findLastMessageContent(recentMessages, 'user'),
        lastAssistantMessage: findLastMessageContent(recentMessages, 'assistant'),
        hasOlderSourceHints,
        hasToolCapableSourceMap,
      })
    : null

  debugMetrics['experimental_agentic_transcript_recall_tool_choice_preflight'] =
    atrToolChoiceDecision?.toolChoice ?? null
  debugMetrics['experimental_agentic_transcript_recall_tool_choice_source'] =
    atrToolChoiceDecision?.source ?? null
  debugMetrics['experimental_agentic_transcript_recall_tool_choice_version'] =
    atrToolChoiceDecision?.version ?? null
  debugMetrics['experimental_agentic_transcript_recall_tool_choice_score'] =
    atrToolChoiceDecision?.score ?? null
  debugMetrics['experimental_agentic_transcript_recall_tool_choice_matches'] =
    atrToolChoiceDecision && atrToolChoiceDecision.matchedRuleIds.length > 0
      ? atrToolChoiceDecision.matchedRuleIds.join(',')
      : null
  debugMetrics['experimental_agentic_transcript_recall_tool_choice_blocks'] =
    atrToolChoiceDecision && atrToolChoiceDecision.blockedRuleIds.length > 0
      ? atrToolChoiceDecision.blockedRuleIds.join(',')
      : null
  debugMetrics['experimental_agentic_transcript_recall_tool_choice_applied'] = false
  debugMetrics['anthropic_thinking_disabled_for_required_tool_choice'] =
    provider === 'anthropic' ? false : null
  const googleToolContract =
    provider === 'google' && agenticTranscriptRecall.enabled && hasToolCapableSourceMap
      ? buildAgenticTranscriptRecallToolContract({
          sourceMap: agenticTranscriptRecallSourceMap,
          toolChoice: atrToolChoiceDecision?.toolChoice ?? 'auto',
        })
      : null

  const model = buildLanguageModel({
    provider,
    modelName,
    apiKey: decryptedApiKey,
    serviceTier: apiKeyData.service_tier ?? 'standard',
  })

  const providerOptions = getProviderOptions(provider, {
    modelName,
    promptCacheKey: promptCache?.key,
    promptCacheRetention: promptCache?.retention,
    reasoningEffort: apiKeyData.reasoning_effort,
  })
  const googleExplicitCache =
    provider === 'google'
      ? await prepareGoogleExplicitCache({
          apiKey: decryptedApiKey,
          modelName,
          systemPrompt: finalSystemPrompt,
          recentMessages,
          providerOptions,
          toolContract: googleToolContract,
          toolCapableInvocation: agenticTranscriptRecall.enabled && hasToolCapableSourceMap,
          disableGoogleExplicitCache,
          jobId,
          timings,
          logDebug,
        })
      : null
  const googleExplicitCacheEnabled = googleExplicitCache?.googleExplicitCacheEnabled ?? false
  const googleCacheDecision = googleExplicitCache?.googleCacheDecision ?? null
  const googleCacheResult = googleExplicitCache?.googleCacheResult ?? null
  debugMetrics['google_explicit_cache_disabled_for_tool_use_preflight'] =
    provider === 'google' ? (googleExplicitCache?.disabledForToolUsePreflight ?? false) : null
  debugMetrics['google_explicit_cache_disabled_for_compatibility_retry'] =
    provider === 'google' ? (googleExplicitCache?.disabledForCompatibilityRetry ?? false) : null
  const anthropicOptions =
    provider === 'anthropic' &&
    providerOptions?.anthropic &&
    typeof providerOptions.anthropic === 'object'
      ? (providerOptions.anthropic as Record<string, unknown>)
      : null
  const anthropicThinking =
    anthropicOptions?.thinking && typeof anthropicOptions.thinking === 'object'
      ? (anthropicOptions.thinking as Record<string, unknown>)
      : null
  const standardAnthropicThinkingDebugMetrics: AnthropicThinkingDebugMetricSnapshot = {
    requested: provider === 'anthropic' ? !!anthropicThinking : null,
    type:
      provider === 'anthropic' && typeof anthropicThinking?.type === 'string'
        ? anthropicThinking.type
        : null,
    effort:
      provider === 'anthropic' && typeof anthropicOptions?.effort === 'string'
        ? anthropicOptions.effort
        : null,
    interleavedThinkingRequested:
      provider === 'anthropic' &&
      Array.isArray(anthropicOptions?.anthropicBeta) &&
      anthropicOptions.anthropicBeta.includes(ANTHROPIC_INTERLEAVED_THINKING_BETA)
        ? true
        : provider === 'anthropic'
          ? false
          : null,
    disabledForRequiredToolChoice: provider === 'anthropic' ? false : null,
  }
  applyAnthropicThinkingDebugMetrics({
    debugMetrics,
    snapshot: standardAnthropicThinkingDebugMetrics,
  })
  const samplingOptions = resolveInvocationSamplingOptions({
    provider,
    modelName,
    reasoningEffort: apiKeyData.reasoning_effort,
  })

  let actualPayload: ChatRunnerActualPayload | null = null

  try {
    const streamPayloadPlan = buildStreamPayloadPlan({
      provider,
      finalSystemPrompt,
      staticSystemPrompt,
      dynamicContext,
      anthropicCache,
      anthropicConversationMessages,
      promptBlocks,
      recentMessages,
      googleExplicitCache,
      providerOptions,
    })

    if (streamPayloadPlan.strategy === 'anthropic-split-system') {
      if (anthropicPlaceholderAdded) {
        logDebug('[Chat Job Runner] Added user placeholder for Anthropic user-first requirement')
      }

      if (anthropicCache?.enabled) {
        logDebug('[Chat Job Runner] Anthropic prompt caching enabled (automatic)', {
          ttl: anthropicCache.ttl,
          staticPromptTokens,
          dynamicContextTokens,
          hasDynamicContext: !!dynamicContext,
        })
      }
    }

    actualPayload = streamPayloadPlan.actualPayload

    if (payload.deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH) {
      await submitAnthropicBatchJob({
        supabase,
        jobId,
        payload,
        apiKey: decryptedApiKey,
        streamPayloadPlan,
        debug: {
          requestId: payload.requestId,
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
          ragInfo,
          actualPayload,
          sanitizedMessageCount: generationTranscript.length,
          bilingualEnabled,
        },
      })

      return {
        status: 'processing',
        promptCache,
        anthropicCache,
        googleExplicitCacheEnabled,
        googleCacheDecision,
        googleCacheResult,
        actualPayload,
      }
    }

    debugMetrics['experimental_agentic_transcript_recall_wrapper_used'] = false
    debugMetrics['experimental_agentic_transcript_recall_fallback_to_standard'] = false

    const standardStreamRequest = streamPayloadPlan.streamRequest
    let finalStreamRequest = standardStreamRequest
    let experimentalStreamTextSettings:
      | ReturnType<typeof prepareExperimentalAgenticTranscriptRecallRequest>['streamTextSettings']
      | undefined

    if (agenticTranscriptRecall.enabled) {
      debugMetrics['experimental_agentic_transcript_recall_wrapper_used'] = true

      try {
        const experimentalResult = prepareExperimentalAgenticTranscriptRecallRequest({
          supabase,
          chatId: payload.chatId,
          runtimeConfig: agenticTranscriptRecall,
          sourceHints: agenticTranscriptRecallSourceHints,
          sourceMap: agenticTranscriptRecallSourceMap,
          streamRequest: streamPayloadPlan.streamRequest,
          debugMetrics,
          logDebug,
        })
        finalStreamRequest = experimentalResult.streamRequest
        experimentalStreamTextSettings =
          atrToolChoiceDecision?.toolChoice === 'required' &&
          experimentalResult.streamTextSettings?.tools
            ? {
                ...experimentalResult.streamTextSettings,
                prepareStep: buildRequiredFirstToolStepOverride(
                  experimentalResult.streamTextSettings.prepareStep,
                ),
              }
            : experimentalResult.streamTextSettings
        debugMetrics['experimental_agentic_transcript_recall_tool_choice_applied'] =
          atrToolChoiceDecision?.toolChoice === 'required' &&
          !!experimentalResult.streamTextSettings?.tools

        if (
          provider === 'anthropic' &&
          debugMetrics['experimental_agentic_transcript_recall_tool_choice_applied']
        ) {
          const { providerOptions: sanitizedProviderOptions, disabled } =
            disableAnthropicThinkingForRequiredToolChoice(
              finalStreamRequest.providerOptions as SharedV2ProviderOptions | undefined,
            )

          if (disabled) {
            finalStreamRequest = {
              ...finalStreamRequest,
              providerOptions: sanitizedProviderOptions,
            }
            debugMetrics['anthropic_thinking_requested'] = false
            debugMetrics['anthropic_thinking_type'] = null
            debugMetrics['anthropic_thinking_effort'] = null
            debugMetrics['anthropic_interleaved_thinking_requested'] = false
            debugMetrics['anthropic_thinking_disabled_for_required_tool_choice'] = true
          }
        }

        if (debugMetrics['experimental_agentic_transcript_recall_tool_choice_applied']) {
          logDebug('[Agentic Transcript Recall] Tool-choice preflight forced tool use', {
            jobId,
            provider,
            modelName,
            score: atrToolChoiceDecision?.score ?? null,
            matchedRules: atrToolChoiceDecision?.matchedRuleIds ?? [],
          })
        }
      } catch (error) {
        debugMetrics['experimental_agentic_transcript_recall_fallback_to_standard'] = true
        logDebug('[Agentic Transcript Recall] Experimental wrapper failed; falling back', {
          error: error instanceof Error ? error.message : String(error),
          provider,
          modelName,
        })
      }
    }

    let stream: Awaited<ReturnType<typeof streamText>>

    try {
      stream = await streamText({
        model,
        ...samplingOptions,
        ...finalStreamRequest,
        ...experimentalStreamTextSettings,
      })
    } catch (error) {
      const usedExperimentalInvocation =
        agenticTranscriptRecall.enabled &&
        (finalStreamRequest !== standardStreamRequest ||
          experimentalStreamTextSettings !== undefined)

      if (!usedExperimentalInvocation) {
        throw error
      }

      debugMetrics['experimental_agentic_transcript_recall_fallback_to_standard'] = true
      debugMetrics['experimental_agentic_transcript_recall_tool_choice_applied'] = false
      applyAnthropicThinkingDebugMetrics({
        debugMetrics,
        snapshot: standardAnthropicThinkingDebugMetrics,
      })
      logDebug('[Agentic Transcript Recall] Experimental stream request failed; falling back', {
        error: error instanceof Error ? error.message : String(error),
        provider,
        modelName,
      })

      stream = await streamText({
        model,
        ...samplingOptions,
        ...standardStreamRequest,
      })
    }

    return {
      status: 'streaming',
      stream,
      promptCache,
      anthropicCache,
      googleExplicitCacheEnabled,
      googleCacheDecision,
      googleCacheResult,
      actualPayload,
    }
  } catch (error) {
    const normalizedError = normalizeProviderError({ provider, error })
    throw new Error(normalizedError.userMessage)
  }
}
