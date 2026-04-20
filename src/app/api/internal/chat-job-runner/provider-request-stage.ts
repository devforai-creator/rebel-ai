import { createAdminClient } from '@/lib/supabase/admin'
import { streamText } from 'ai'
import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH } from '@/lib/chat/delivery-mode'
import {
  createGoogleCache,
  isGoogleExplicitCacheEnabled,
  resolveGoogleCacheDecision,
  type CreateGoogleCacheResult,
} from '@/lib/llm/google-cache'
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
import { submitAnthropicBatchJob } from './anthropic-batch-orchestrator'
import type { LoadedChatJobExecutionContext } from './execution-context'
import { buildLanguageModel } from './model-factory'
import { buildStreamPayloadPlan } from './stream-payload-builder'
import type { ChatRunnerActualPayload } from './usage-debug'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type GoogleCacheDecision = ReturnType<typeof resolveGoogleCacheDecision>

type ProviderRequestArtifacts = {
  promptCache: PromptCacheDecision | null
  anthropicCache: AnthropicCacheDecision | null
  googleExplicitCacheEnabled: boolean
  googleCacheDecision: GoogleCacheDecision | null
  googleCacheResult: CreateGoogleCacheResult | null
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

export async function requestProviderStage({
  supabase,
  jobId,
  payload,
  context,
  timings,
  logDebug = () => undefined,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  payload: ChatGenerationJobPayload
  context: LoadedChatJobExecutionContext
  timings: Record<string, number>
  logDebug?: (...args: unknown[]) => void
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

  const allMessagesForGoogle = provider === 'google' ? recentMessages : []
  const messagesToCacheForGoogle =
    provider === 'google' && allMessagesForGoogle.length > 1
      ? allMessagesForGoogle.slice(0, -1)
      : []
  const lastMessageForGoogle =
    provider === 'google' && allMessagesForGoogle.length > 0
      ? allMessagesForGoogle[allMessagesForGoogle.length - 1]
      : null

  const googleCacheDecision =
    provider === 'google'
      ? resolveGoogleCacheDecision({
          modelName,
          systemPrompt: finalSystemPrompt,
          messagesToCache: messagesToCacheForGoogle,
        })
      : null

  const googleExplicitCacheEnabled = isGoogleExplicitCacheEnabled()
  let googleCacheResult: CreateGoogleCacheResult | null = null
  if (
    provider === 'google' &&
    googleExplicitCacheEnabled &&
    googleCacheDecision?.enabled &&
    lastMessageForGoogle
  ) {
    const googleCacheCreateStart = performance.now()
    googleCacheResult = await createGoogleCache({
      apiKey: decryptedApiKey,
      modelName,
      systemPrompt: finalSystemPrompt,
      messagesToCache: messagesToCacheForGoogle,
      ttlSeconds: 20,
    })
    timings['7c_google_cache_create'] = performance.now() - googleCacheCreateStart

    if (googleCacheResult.success) {
      logDebug('[Chat Job Runner] Google cache created', {
        cacheName: googleCacheResult.cacheName,
        cachedTokenCount: googleCacheResult.cachedTokenCount,
        modelName,
      })
    } else {
      console.warn(
        '[Chat Job Runner] Google cache creation failed, falling back to normal request',
        {
          error: googleCacheResult.error,
          code: googleCacheResult.code,
          modelName,
        },
      )
    }
  }

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
  debugMetrics['anthropic_thinking_requested'] =
    provider === 'anthropic' ? !!anthropicThinking : null
  debugMetrics['anthropic_thinking_type'] =
    provider === 'anthropic' && typeof anthropicThinking?.type === 'string'
      ? anthropicThinking.type
      : null
  debugMetrics['anthropic_thinking_effort'] =
    provider === 'anthropic' && typeof anthropicOptions?.effort === 'string'
      ? anthropicOptions.effort
      : null
  debugMetrics['anthropic_interleaved_thinking_requested'] =
    provider === 'anthropic' &&
    Array.isArray(anthropicOptions?.anthropicBeta) &&
    anthropicOptions.anthropicBeta.includes(ANTHROPIC_INTERLEAVED_THINKING_BETA)
      ? true
      : provider === 'anthropic'
        ? false
        : null
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
      googleCacheResult,
      messagesToCacheForGoogle,
      lastMessageForGoogle,
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

    if (
      streamPayloadPlan.strategy === 'google-explicit-cache' &&
      googleCacheResult?.success &&
      lastMessageForGoogle
    ) {
      logDebug('[Chat Job Runner] Google explicit caching enabled', {
        cacheName: googleCacheResult.cacheName,
        cachedTokenCount: googleCacheResult.cachedTokenCount,
        lastMessageRole: lastMessageForGoogle.role,
      })
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
        experimentalStreamTextSettings = experimentalResult.streamTextSettings
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
