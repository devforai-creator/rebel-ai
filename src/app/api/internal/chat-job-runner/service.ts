import { createAdminClient } from '@/lib/supabase/admin'
import type { ApiKey, Chat, Database, Persona, Character } from '@/types/database.types'
import { ensureUserFirstForAnthropic } from '@/lib/chat/anthropic-user-first'
import { buildMemoryPlan } from '@/lib/chat-memory'
import { getGlobalSystemPrompt } from '@/lib/chat/global-system-prompt'
import { parseChatJobPayload, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { streamText } from 'ai'
import { claimPendingJob } from '@/lib/chat/job-queue'
import { getProviderOptions } from '@/lib/llm/provider-options'
import { resolvePromptCacheDecision, resolveAnthropicCacheDecision } from '@/lib/llm/prompt-cache'
import {
  createGoogleCache,
  resolveGoogleCacheDecision,
  isGoogleExplicitCacheEnabled,
  type CreateGoogleCacheResult,
} from '@/lib/llm/google-cache'
import { estimateUsageCost } from '@/lib/model-pricing'
import { resolveInternalApiOrigin } from '@/lib/internal-api-origin'
import { applyBilingualContext, isBilingualEnabled } from '@/lib/chat/bilingual-context'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { normalizeChatModelConfig } from '@/lib/chat/model-config'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH } from '@/lib/chat/delivery-mode'
import { normalizeProviderError } from '@/lib/llm/provider-error'
import { resolveInvocationSamplingOptions } from '@/lib/llm/invocation-sampling'
import {
  createAnthropicMessageBatch,
  extractTextFromAnthropicBatchMessage,
  retrieveAnthropicBatchResult,
  retrieveAnthropicMessageBatch,
  type AnthropicBatchMessageParams,
  type AnthropicTextBlock,
} from '@/lib/llm/anthropic-batch'
import { buildLorebookDynamicContext } from '@/lib/lorebook/runtime'
import { loadGenerationTranscript } from '@/lib/chat/turns'
import { buildLanguageModel } from './model-factory'
import { evaluateContentFilter } from './content-filter'
import { buildSystemPrompt } from './system-prompt-builder'
import { buildChatDebugInfo, type ChatRunnerActualPayload } from './usage-debug'
import { buildStreamPayloadPlan } from './stream-payload-builder'
import { runPostGenerationPipeline } from './post-generation-pipeline'
import {
  broadcastAssistantStreamError,
  broadcastAssistantStreamSnapshot,
} from './assistant-stream-broadcaster'

const MAX_TOTAL_INPUT_TOKENS = 150_000
const CHAT_JOB_RUNNER_DEBUG_ENABLED = process.env.CHAT_JOB_RUNNER_DEBUG === 'true'
type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type ChatGenerationJobUpdate = Database['public']['Tables']['chat_generation_jobs']['Update']
type RunnerApiKeyRow = Pick<ApiKey, 'vault_secret_name' | 'service_tier' | 'reasoning_effort'>
type BatchApiKeyRow = Pick<ApiKey, 'vault_secret_name' | 'service_tier'>
type RunnerChatRow = Pick<
  Chat,
  'id' | 'user_id' | 'character_id' | 'persona_id' | 'custom_system_prompt' | 'model_config'
>
type RunnerPersonaRow = Pick<Persona, 'name' | 'description'>
type RunnerCharacterRow = Pick<Character, 'id' | 'name' | 'system_prompt'> & {
  post_history_instructions: string | null
}
type VaultRpcClient = {
  rpc: (
    fn: 'get_decrypted_secret',
    args: Database['public']['Functions']['get_decrypted_secret']['Args'],
  ) => Promise<{
    data: Database['public']['Functions']['get_decrypted_secret']['Returns'] | null
    error: { message: string; code?: string | null; details?: string | null } | null
  }>
}

type BatchJobRow = Pick<
  Database['public']['Tables']['chat_generation_jobs']['Row'],
  | 'id'
  | 'chat_id'
  | 'user_id'
  | 'status'
  | 'payload'
  | 'delivery_mode'
  | 'external_provider_job_id'
  | 'external_provider_status'
  | 'external_provider_last_checked_at'
  | 'external_provider_result_url'
  | 'external_provider_metadata'
>

type AnthropicBatchJobMetadata = {
  customId: string
  submittedRequest: AnthropicBatchMessageParams
  debug: {
    requestId: string
    finalSystemPrompt: string
    recentMessages: ChatGenerationJobPayload['sanitizedMessages']
    anthropicConversationMessages: Array<{ role: string; content: string }> | null
    anthropicPlaceholderAdded: boolean
    promptCache: ReturnType<typeof resolvePromptCacheDecision>
    totalInputTokens: number
    anthropicCache: ReturnType<typeof resolveAnthropicCacheDecision>
    staticPromptTokens: number
    dynamicContext: string | null
    dynamicContextTokens: number
    ragInfo: unknown
    actualPayload: ChatRunnerActualPayload | null
    sanitizedMessageCount: number
    bilingualEnabled: boolean
  }
}

const ANTHROPIC_BATCH_MAX_TOKENS = resolveAnthropicBatchMaxTokens()
const ANTHROPIC_BATCH_STATUS_POLL_INTERVAL_MS = Number(
  process.env.ANTHROPIC_BATCH_STATUS_POLL_INTERVAL_MS ?? 10_000,
)

function logChatJobRunnerDebug(...args: unknown[]): void {
  if (CHAT_JOB_RUNNER_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

async function collectTextFromStreamWithSnapshots({
  supabase,
  chatId,
  jobId,
  stream,
  provider,
  regenerateAssistantMessageId,
  updateIntervalMs = 120,
  now = () => performance.now(),
}: {
  supabase: AdminSupabaseClient
  chatId: string
  jobId: string
  stream: {
    textStream: AsyncIterable<string> | Iterable<string>
    fullStream?:
      | AsyncIterable<{ type: string; text?: string; error?: unknown }>
      | Iterable<{
          type: string
          text?: string
          error?: unknown
        }>
  }
  provider: string
  regenerateAssistantMessageId: string | null
  updateIntervalMs?: number
  now?: () => number
}) {
  let fullText = ''
  let lastBroadcastAt = now()
  let sendInFlight: Promise<void> | null = null
  let queuedContent: string | null = null
  let lastSentContent = ''

  const sendSnapshot = (content: string) => {
    if (content === lastSentContent) {
      return
    }

    if (sendInFlight) {
      queuedContent = content
      return
    }

    const snapshot = content
    sendInFlight = broadcastAssistantStreamSnapshot({
      supabase,
      chatId,
      jobId,
      content: snapshot,
      regenerateAssistantMessageId,
    }).finally(() => {
      lastSentContent = snapshot
      sendInFlight = null

      if (queuedContent && queuedContent !== lastSentContent) {
        const nextContent = queuedContent
        queuedContent = null
        sendSnapshot(nextContent)
        return
      }

      queuedContent = null
    })
  }

  const flushSnapshots = async () => {
    while (sendInFlight) {
      await sendInFlight
    }
  }

  if (stream.fullStream) {
    for await (const part of stream.fullStream) {
      if (part.type === 'text-delta' && typeof part.text === 'string') {
        fullText += part.text

        const currentTime = now()
        if (currentTime - lastBroadcastAt >= updateIntervalMs) {
          sendSnapshot(fullText)
          lastBroadcastAt = currentTime
        }
      }

      if (part.type === 'error') {
        const normalizedError = normalizeProviderError({
          provider,
          error: part.error,
        })
        throw new Error(normalizedError.userMessage)
      }
    }
  } else {
    for await (const chunk of stream.textStream) {
      fullText += chunk

      const currentTime = now()
      if (currentTime - lastBroadcastAt >= updateIntervalMs) {
        sendSnapshot(fullText)
        lastBroadcastAt = currentTime
      }
    }
  }

  if (fullText) {
    sendSnapshot(fullText)
    await flushSnapshots()
  }

  return fullText
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

    const result = await processJob({
      supabase,
      jobId: job.id,
      rawPayload: job.payload,
      origin,
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

async function processJob({
  supabase,
  jobId,
  rawPayload,
  origin,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  rawPayload: unknown
  origin: string
}): Promise<{ jobId: string; status: string; error?: string }> {
  const payload = parseChatJobPayload(rawPayload)

  if (!payload) {
    const invalidPayloadUpdate: ChatGenerationJobUpdate = {
      status: 'error',
      error: 'Invalid job payload',
    }
    await supabase
      .from('chat_generation_jobs')
      .update(invalidPayloadUpdate as never)
      .eq('id', jobId)
    return { jobId, status: 'error', error: 'Invalid job payload' }
  }

  try {
    const execution = await executeJob({ supabase, jobId, payload, origin })

    if (execution.status === 'processing') {
      return { jobId, status: 'processing' }
    }

    const successUpdate: ChatGenerationJobUpdate = { status: 'success', error: null }
    await supabase
      .from('chat_generation_jobs')
      .update(successUpdate as never)
      .eq('id', jobId)

    return { jobId, status: 'success' }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown job failure'
    const errorUpdate: ChatGenerationJobUpdate = { status: 'error', error: message }
    await supabase
      .from('chat_generation_jobs')
      .update(errorUpdate as never)
      .eq('id', jobId)

    console.error('[Chat Job Runner] Job failed', { jobId, error })
    return { jobId, status: 'error', error: message }
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
}): Promise<{ status: 'success' | 'processing' }> {
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

  const apiKeyQueryStart = performance.now()
  const apiKeyQueryPromise = supabase
    .from('api_keys')
    .select<'vault_secret_name, service_tier, reasoning_effort'>(
      'vault_secret_name, service_tier, reasoning_effort',
    )
    .eq('id', apiKeyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single<RunnerApiKeyRow>()
    .then((result) => {
      timings['1_api_key_query'] = performance.now() - apiKeyQueryStart
      return result
    })

  const chatQueryStart = performance.now()
  const chatQueryPromise = supabase
    .from('chats')
    .select<'id, user_id, character_id, persona_id, custom_system_prompt, model_config'>(
      'id, user_id, character_id, persona_id, custom_system_prompt, model_config',
    )
    .eq('id', chatId)
    .eq('user_id', userId)
    .single<RunnerChatRow>()
    .then((result) => {
      timings['2_chat_query'] = performance.now() - chatQueryStart
      return result
    })

  const [{ data: apiKeyData, error: apiKeyError }, { data: chat, error: chatError }] =
    await Promise.all([apiKeyQueryPromise, chatQueryPromise])

  if (apiKeyError || !apiKeyData) {
    throw new Error('API key not found or inactive')
  }
  if (chatError || !chat) {
    throw new Error('Chat not found')
  }

  const apiKeyDecryptStart = performance.now()
  const apiKeyDecryptPromise = decryptSecret({
    supabase,
    secretName: apiKeyData.vault_secret_name,
    requester: userId,
  }).then((decrypted) => {
    timings['3_api_key_decrypt'] = performance.now() - apiKeyDecryptStart
    return decrypted
  })

  const personaQueryStart = performance.now()
  const personaPromise = chat.persona_id
    ? supabase
        .from('personas')
        .select<'name, description'>('name, description')
        .eq('id', chat.persona_id)
        .eq('user_id', userId)
        .single<RunnerPersonaRow>()
        .then((result) => {
          timings['4_persona_query'] = performance.now() - personaQueryStart
          return result
        })
    : Promise.resolve({
        data: null as { name: string; description: string | null } | null,
        error: null,
      }).then((result) => {
        timings['4_persona_query'] = performance.now() - personaQueryStart
        return result
      })

  const characterQueryStart = performance.now()
  const characterPromise = supabase
    .from('characters')
    .select(
      `
      id,
      name,
      system_prompt,
      post_history_instructions:metadata->>post_history_instructions
    `,
    )
    .eq('id', chat.character_id)
    .single<RunnerCharacterRow>()
    .then((result) => {
      timings['5_character_query'] = performance.now() - characterQueryStart
      return result
    })

  const [decryptedApiKey, { data: personaData }, { data: character, error: characterError }] =
    await Promise.all([apiKeyDecryptPromise, personaPromise, characterPromise])

  let persona: { name: string; description: string | null } | null = null
  if (personaData) {
    persona = personaData
  }

  if (characterError || !character) {
    throw new Error('Character not found')
  }

  const defaultSystemPrompt = getGlobalSystemPrompt()
  const normalizedModelConfig = normalizeChatModelConfig(chat.model_config)
  const generationTranscript = payload.turnId
    ? await loadGenerationTranscript({
        supabase,
        chatId,
        turnId: payload.turnId,
        excludeAssistantForTurnId: payload.isRegeneration ? payload.turnId : null,
      })
    : payload.sanitizedMessages

  stepStart = performance.now()
  const systemPrompt = await buildSystemPrompt({
    character,
    persona,
    defaultSystemPrompt,
    customSystemPrompt: chat.custom_system_prompt,
  })
  timings['6_build_system_prompt'] = performance.now() - stepStart

  stepStart = performance.now()
  const lorebookDynamicContext = await buildLorebookDynamicContext({
    supabase,
    chatId,
    characterId: character.id,
    chatHistory: generationTranscript,
  })
  timings['6b_build_lorebook_context'] = performance.now() - stepStart

  stepStart = performance.now()
  const {
    dynamicContext,
    fallbackMessages: rawRecentMessages,
    fallbackSystemPrompt,
    promptBlocks,
    staticSystemPrompt,
    ragInfo,
  } = await buildMemoryPlan({
    supabase,
    chatId,
    sanitizedMessages: generationTranscript,
    baseSystemPrompt: systemPrompt,
    extraDynamicContext: lorebookDynamicContext ? [lorebookDynamicContext] : undefined,
    modelConfig: normalizedModelConfig,
  })
  const finalSystemPrompt = fallbackSystemPrompt
  timings['7_build_context'] = performance.now() - stepStart

  // Apply bilingual memory: use English translations for older messages to reduce token usage
  // Recent 4 messages (2 turns) keep original Korean for style consistency
  stepStart = performance.now()
  const bilingualEnabled = await isBilingualEnabled(supabase, userId)
  const bilingualMessages = bilingualEnabled
    ? await applyBilingualContext({
        supabase,
        chatId,
        messages: rawRecentMessages,
        recentKoreanCount: 4, // 2 turns
      })
    : rawRecentMessages
  timings['7b_bilingual_context'] = performance.now() - stepStart

  const recentMessages = bilingualMessages

  // For Anthropic caching: separate the static prompt from dynamic context.
  // Static prompt = global/custom prompt + post-history + character + persona.
  const systemPromptTokens = estimateTokens(finalSystemPrompt)
  const messagesTokens = recentMessages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)

  // For Anthropic, apply user-first guard to the current conversation messages.
  // This is computed here for accurate token estimation
  const { messages: anthropicConversationMessages, placeholderAdded: anthropicPlaceholderAdded } =
    provider === 'anthropic'
      ? ensureUserFirstForAnthropic(recentMessages)
      : { messages: recentMessages, placeholderAdded: false }

  const anthropicPlaceholderTokens = anthropicPlaceholderAdded ? estimateTokens('(continue)') : 0
  const totalInputTokens = systemPromptTokens + messagesTokens + anthropicPlaceholderTokens

  if (totalInputTokens > MAX_TOTAL_INPUT_TOKENS) {
    throw new Error(`Input context too large (${totalInputTokens.toLocaleString()} tokens)`)
  }

  const chatCacheKeyOverride = provider === 'openai' ? `chat:${chatId}` : undefined

  const promptCache = resolvePromptCacheDecision({
    provider,
    modelName,
    systemPrompt: finalSystemPrompt,
    messages: recentMessages,
    totalInputTokens,
    cacheKeyOverride: chatCacheKeyOverride,
    retentionPreference: chatCacheKeyOverride ? '24h' : undefined,
  })

  // Anthropic-specific cache decision based on cached prefix tokens.
  const staticPromptTokens = estimateTokens(staticSystemPrompt)
  const anthropicCache =
    provider === 'anthropic'
      ? resolveAnthropicCacheDecision({
          modelName,
        })
      : null

  // Google-specific cache decision
  // Pre-create cache with system prompt + history (excluding last message)
  // Then use cache ID for actual request with only the last message.
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

  // Pre-create Google cache if enabled (controlled by GOOGLE_EXPLICIT_CACHE_ENABLED env var)
  const googleExplicitCacheEnabled = isGoogleExplicitCacheEnabled()
  let googleCacheResult: CreateGoogleCacheResult | null = null
  if (
    provider === 'google' &&
    googleExplicitCacheEnabled &&
    googleCacheDecision?.enabled &&
    lastMessageForGoogle
  ) {
    stepStart = performance.now()
    googleCacheResult = await createGoogleCache({
      apiKey: decryptedApiKey,
      modelName,
      systemPrompt: finalSystemPrompt,
      messagesToCache: messagesToCacheForGoogle,
      ttlSeconds: 20, // Short TTL to minimize storage cost
    })
    timings['7c_google_cache_create'] = performance.now() - stepStart

    if (googleCacheResult.success) {
      logChatJobRunnerDebug('[Chat Job Runner] Google cache created', {
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
    promptCacheKey: promptCache?.key,
    promptCacheRetention: promptCache?.retention,
    reasoningEffort: apiKeyData.reasoning_effort,
  })
  const samplingOptions = resolveInvocationSamplingOptions({
    provider,
    modelName,
    reasoningEffort: apiKeyData.reasoning_effort,
  })

  stepStart = performance.now()
  let stream

  // Capture actual payload sent to LLM for debug_info (SSOT)
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
        logChatJobRunnerDebug(
          '[Chat Job Runner] Added user placeholder for Anthropic user-first requirement',
        )
      }

      if (anthropicCache?.enabled) {
        logChatJobRunnerDebug('[Chat Job Runner] Anthropic prompt caching enabled (automatic)', {
          ttl: anthropicCache.ttl,
          staticPromptTokens,
          dynamicContextTokens: dynamicContext ? estimateTokens(dynamicContext) : 0,
          hasDynamicContext: !!dynamicContext,
        })
      }
    }

    if (
      streamPayloadPlan.strategy === 'google-explicit-cache' &&
      googleCacheResult?.success &&
      lastMessageForGoogle
    ) {
      logChatJobRunnerDebug('[Chat Job Runner] Google explicit caching enabled', {
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
          dynamicContextTokens: dynamicContext ? estimateTokens(dynamicContext) : 0,
          ragInfo,
          actualPayload,
          sanitizedMessageCount: generationTranscript.length,
          bilingualEnabled,
        },
      })

      return { status: 'processing' }
    }

    stream = await streamText({
      model,
      ...samplingOptions,
      ...streamPayloadPlan.streamRequest,
    })
  } catch (error) {
    const normalizedError = normalizeProviderError({ provider, error })
    throw new Error(normalizedError.userMessage)
  }

  let fullText = ''
  try {
    fullText = await collectTextFromStreamWithSnapshots({
      supabase,
      chatId,
      jobId,
      stream,
      provider,
      regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
    })
  } catch (error) {
    await broadcastAssistantStreamError({
      supabase,
      chatId,
      jobId,
      error: error instanceof Error ? error.message : String(error),
      regenerateAssistantMessageId: payload.regenerateAssistantMessageId,
    })
    throw error
  }
  let assistantMessageId: string | null = null
  let messageInsertDuration: number | null = null

  const finishReason = await stream.finishReason
  const providerMetadata = await stream.providerMetadata
  timings['8_llm_generation'] = performance.now() - stepStart

  const anthropicProviderMetadata =
    provider === 'anthropic' &&
    providerMetadata?.anthropic &&
    typeof providerMetadata.anthropic === 'object'
      ? (providerMetadata.anthropic as Record<string, unknown>)
      : null
  const anthropicRawUsage = anthropicProviderMetadata?.usage as Record<string, number> | undefined
  const anthropicCacheCreationInputTokens =
    typeof anthropicProviderMetadata?.cacheCreationInputTokens === 'number'
      ? anthropicProviderMetadata.cacheCreationInputTokens
      : (anthropicRawUsage?.cache_creation_input_tokens ?? null)

  // Log Anthropic cache metrics
  if (anthropicRawUsage) {
    logChatJobRunnerDebug('[Chat Job Runner] Anthropic cache metrics', {
      cacheRead: anthropicRawUsage.cache_read_input_tokens ?? 0,
      cacheCreation: anthropicCacheCreationInputTokens ?? 0,
      uncached: anthropicRawUsage.input_tokens ?? 0,
    })
  }

  const contentFilterInfo = evaluateContentFilter({
    provider,
    finishReason,
    metadata: providerMetadata,
  })

  const assistantText = fullText.trim()

  if (!assistantText) {
    const filteredMessage =
      finishReason === 'error'
        ? 'The provider returned an error before producing text. Please try again later.'
        : contentFilterInfo.blocked
          ? 'Blocked by Google Gemini content filter. Please disable safe mode or refine your input and try again.'
          : 'The assistant returned an empty response. Please try again later.'

    // Error is stored in chat_jobs.error and shown via toast popup
    throw new Error(filteredMessage)
  }

  const usage = await stream.usage
  const promptTokens = usage?.inputTokens ?? null
  const completionTokens = usage?.outputTokens ?? null
  const totalTokens = usage?.totalTokens ?? null
  const cachedInputTokens = usage?.cachedInputTokens ?? null
  const reasoningTokens = usage?.reasoningTokens ?? null
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
  const debugConversationMessages = provider === 'anthropic' ? anthropicConversationMessages : null
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
    dynamicContextTokens: dynamicContext ? estimateTokens(dynamicContext) : 0,
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
}

async function submitAnthropicBatchJob({
  supabase,
  jobId,
  payload,
  apiKey,
  streamPayloadPlan,
  debug,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  payload: ChatGenerationJobPayload
  apiKey: string
  streamPayloadPlan: ReturnType<typeof buildStreamPayloadPlan>
  debug: AnthropicBatchJobMetadata['debug']
}): Promise<void> {
  if (payload.provider !== 'anthropic') {
    throw new Error('Anthropic Batch delivery mode requires the Anthropic provider')
  }

  const customId = buildAnthropicBatchCustomId(jobId)
  const submittedRequest = buildAnthropicBatchRequest({
    modelName: payload.modelName,
    streamPayloadPlan,
  })

  const batch = await createAnthropicMessageBatch({
    apiKey,
    customId,
    params: submittedRequest,
  })

  const metadata: AnthropicBatchJobMetadata = {
    customId,
    submittedRequest,
    debug,
  }
  const batchUpdate: ChatGenerationJobUpdate = {
    external_provider_job_id: batch.id,
    external_provider_status: batch.processing_status,
    external_provider_submitted_at: batch.created_at,
    external_provider_last_checked_at: new Date().toISOString(),
    external_provider_result_url: batch.results_url,
    external_provider_metadata: metadata as never,
  }

  await supabase
    .from('chat_generation_jobs')
    .update(batchUpdate as never)
    .eq('id', jobId)
}

function buildAnthropicBatchRequest({
  modelName,
  streamPayloadPlan,
}: {
  modelName: string
  streamPayloadPlan: ReturnType<typeof buildStreamPayloadPlan>
}): AnthropicBatchMessageParams {
  if (streamPayloadPlan.actualPayload.provider !== 'anthropic') {
    throw new Error('Anthropic Batch can only submit Anthropic payloads')
  }

  const systemBlocks = streamPayloadPlan.actualPayload.systemMessages.map<AnthropicTextBlock>(
    (message) => {
      const block: AnthropicTextBlock = {
        type: 'text',
        text: message.content,
      }

      if (message.cached) {
        block.cache_control = { type: 'ephemeral' }
      }

      return block
    },
  )

  const cacheControl = extractAnthropicRequestCacheControl(streamPayloadPlan)
  const params: AnthropicBatchMessageParams = {
    model: modelName,
    max_tokens: ANTHROPIC_BATCH_MAX_TOKENS,
    system: systemBlocks.length > 0 ? systemBlocks : undefined,
    messages: streamPayloadPlan.actualPayload.conversationMessages
      .filter((message): message is { role: 'user' | 'assistant'; content: string } => {
        return message.role === 'user' || message.role === 'assistant'
      })
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ...(cacheControl ? { cache_control: cacheControl } : {}),
  }

  if (params.messages.length === 0) {
    throw new Error('Anthropic Batch request requires at least one conversation message')
  }

  return params
}

function extractAnthropicRequestCacheControl(
  streamPayloadPlan: ReturnType<typeof buildStreamPayloadPlan>,
): AnthropicBatchMessageParams['cache_control'] | null {
  const anthropicOptions = streamPayloadPlan.streamRequest.providerOptions?.anthropic as
    | Record<string, unknown>
    | undefined
  const cacheControl = anthropicOptions?.cacheControl
  if (!cacheControl || typeof cacheControl !== 'object') {
    return null
  }

  const raw = cacheControl as Record<string, unknown>
  if (raw.type !== 'ephemeral') {
    return null
  }

  return {
    type: 'ephemeral',
    ...(raw.ttl === '1h' ? { ttl: '1h' as const } : {}),
  }
}

function buildAnthropicBatchCustomId(jobId: string): string {
  return `job-${jobId}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

function resolveAnthropicBatchMaxTokens(): number {
  const raw = Number(process.env.ANTHROPIC_BATCH_MAX_TOKENS ?? '8192')
  if (!Number.isFinite(raw) || raw < 1) {
    return 8192
  }
  return Math.trunc(raw)
}

async function pollDueAnthropicBatchJobs({
  supabase,
  origin,
  limit,
}: {
  supabase: AdminSupabaseClient
  origin: string
  limit: number
}): Promise<Array<{ jobId: string; status: string; error?: string }>> {
  const { data, error } = await supabase
    .from('chat_generation_jobs')
    .select(
      'id, chat_id, user_id, status, payload, delivery_mode, external_provider_job_id, external_provider_status, external_provider_last_checked_at, external_provider_result_url, external_provider_metadata',
    )
    .eq('delivery_mode', CHAT_DELIVERY_MODE_ANTHROPIC_BATCH)
    .eq('status', 'processing')
    .not('external_provider_job_id', 'is', null)
    .order('external_provider_last_checked_at', { ascending: true, nullsFirst: true })
    .limit(limit)

  if (error) {
    console.warn('[Chat Job Runner] Failed to load Anthropic batch jobs', {
      error: error.message,
    })
    return []
  }

  const results: Array<{ jobId: string; status: string; error?: string }> = []
  for (const job of (data ?? []) as BatchJobRow[]) {
    if (!isAnthropicBatchPollDue(job.external_provider_last_checked_at)) {
      continue
    }
    results.push(await pollAnthropicBatchJob({ supabase, job, origin }))
  }

  return results
}

export async function pollAnthropicBatchJobForUser({
  jobId,
  userId,
  origin,
}: {
  jobId: string
  userId: string
  origin: string
}): Promise<{ jobId: string; status: string; error?: string } | null> {
  const supabase = createAdminClient()
  const { data: job, error } = await supabase
    .from('chat_generation_jobs')
    .select(
      'id, chat_id, user_id, status, payload, delivery_mode, external_provider_job_id, external_provider_status, external_provider_last_checked_at, external_provider_result_url, external_provider_metadata',
    )
    .eq('id', jobId)
    .eq('user_id', userId)
    .maybeSingle<BatchJobRow>()

  if (error || !job) {
    return null
  }

  if (
    job.delivery_mode !== CHAT_DELIVERY_MODE_ANTHROPIC_BATCH ||
    job.status !== 'processing' ||
    !job.external_provider_job_id
  ) {
    return { jobId: job.id, status: job.status }
  }

  if (!isAnthropicBatchPollDue(job.external_provider_last_checked_at)) {
    return { jobId: job.id, status: job.status }
  }

  return pollAnthropicBatchJob({ supabase, job, origin })
}

async function pollAnthropicBatchJob({
  supabase,
  job,
  origin,
}: {
  supabase: AdminSupabaseClient
  job: BatchJobRow
  origin: string
}): Promise<{ jobId: string; status: string; error?: string }> {
  const payload = parseChatJobPayload(job.payload)
  if (!payload) {
    await markBatchJobError({ supabase, jobId: job.id, error: 'Invalid job payload' })
    return { jobId: job.id, status: 'error', error: 'Invalid job payload' }
  }

  const metadata = parseAnthropicBatchMetadata(job.external_provider_metadata)
  if (!metadata) {
    const error = 'Anthropic batch metadata is missing or invalid'
    await markBatchJobError({ supabase, jobId: job.id, error })
    return { jobId: job.id, status: 'error', error }
  }

  try {
    const { apiKey } = await loadBatchApiKey({
      supabase,
      apiKeyId: payload.apiKeyId,
      userId: payload.userId,
    })

    const batch = await retrieveAnthropicMessageBatch({
      apiKey,
      batchId: job.external_provider_job_id ?? '',
    })

    const checkedAt = new Date().toISOString()
    const batchProgressUpdate: ChatGenerationJobUpdate = {
      external_provider_status: batch.processing_status,
      external_provider_last_checked_at: checkedAt,
      external_provider_result_url: batch.results_url,
    }
    await supabase
      .from('chat_generation_jobs')
      .update(batchProgressUpdate as never)
      .eq('id', job.id)

    if (batch.processing_status !== 'ended') {
      return { jobId: job.id, status: 'processing' }
    }

    if (!batch.results_url) {
      throw new Error('Anthropic batch ended without a results URL')
    }

    const result = await retrieveAnthropicBatchResult({
      apiKey,
      resultsUrl: batch.results_url,
      customId: metadata.customId,
    })

    if (!result) {
      throw new Error('Anthropic batch result was not found for this chat job')
    }

    const batchRequestResult = result.result
    if (batchRequestResult.type !== 'succeeded') {
      throw new Error(
        batchRequestResult.error?.message ??
          `Anthropic batch request ended with result type: ${batchRequestResult.type}`,
      )
    }

    const batchMessage = batchRequestResult.message
    const assistantText = extractTextFromAnthropicBatchMessage(batchMessage).trim()
    if (!assistantText) {
      throw new Error('Anthropic batch returned an empty response')
    }

    const usage = batchMessage.usage
    const promptTokens = usage?.input_tokens ?? null
    const completionTokens = usage?.output_tokens ?? null
    const cachedInputTokens = usage?.cache_read_input_tokens ?? null
    const usageMetrics = {
      promptTokens,
      completionTokens,
      totalTokens:
        promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null,
      cachedInputTokens,
      reasoningTokens: null,
    }
    const usageCost = estimateUsageCost({
      provider: 'anthropic',
      modelName: payload.modelName,
      promptTokens: promptTokens ?? undefined,
      completionTokens: completionTokens ?? undefined,
      cachedInputTokens: cachedInputTokens ?? undefined,
      serviceTier: 'batch',
    })

    const debugInfo = buildChatDebugInfo({
      ...metadata.debug,
      anthropicCacheCreationInputTokens: usage?.cache_creation_input_tokens ?? null,
      anthropicCacheReadInputTokens: cachedInputTokens,
      googleExplicitCacheEnabled: false,
      googleCacheResult: null,
      googleCacheDecision: null,
      rawResponse: assistantText,
      processedResponse: assistantText,
      apiKeyId: payload.apiKeyId,
      provider: payload.provider,
      modelName: payload.modelName,
      finishReason: batchMessage.stop_reason,
      usage: usageMetrics,
    })

    await runPostGenerationPipeline({
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
      promptTokens,
      completionTokens,
      debugInfo,
      bilingualEnabled: metadata.debug.bilingualEnabled,
      messageInsertDuration: null,
      usage: usageMetrics,
      usageCost,
      triggerMessageTranslationFn: triggerMessageTranslation,
    })

    const successUpdate: ChatGenerationJobUpdate = {
      status: 'success',
      error: null,
      external_provider_status: batch.processing_status,
      external_provider_result_url: batch.results_url,
      external_provider_last_checked_at: new Date().toISOString(),
    }
    await supabase
      .from('chat_generation_jobs')
      .update(successUpdate as never)
      .eq('id', job.id)

    return { jobId: job.id, status: 'success' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markBatchJobError({ supabase, jobId: job.id, error: message })
    return { jobId: job.id, status: 'error', error: message }
  }
}

async function loadBatchApiKey({
  supabase,
  apiKeyId,
  userId,
}: {
  supabase: AdminSupabaseClient
  apiKeyId: string
  userId: string
}): Promise<{ apiKey: string; apiKeyData: BatchApiKeyRow }> {
  const { data: apiKeyData, error } = await supabase
    .from('api_keys')
    .select<'vault_secret_name, service_tier'>('vault_secret_name, service_tier')
    .eq('id', apiKeyId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single<BatchApiKeyRow>()

  if (error || !apiKeyData) {
    throw new Error('API key not found or inactive')
  }

  const apiKey = await decryptSecret({
    supabase,
    secretName: apiKeyData.vault_secret_name,
    requester: userId,
  })

  return { apiKey, apiKeyData }
}

function parseAnthropicBatchMetadata(raw: unknown): AnthropicBatchJobMetadata | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }

  const candidate = raw as Partial<AnthropicBatchJobMetadata>
  if (
    typeof candidate.customId !== 'string' ||
    !candidate.submittedRequest ||
    typeof candidate.submittedRequest !== 'object' ||
    !candidate.debug ||
    typeof candidate.debug !== 'object'
  ) {
    return null
  }

  return candidate as AnthropicBatchJobMetadata
}

function isAnthropicBatchPollDue(lastCheckedAt: string | null): boolean {
  if (!lastCheckedAt) {
    return true
  }
  const lastCheckedMs = Date.parse(lastCheckedAt)
  if (!Number.isFinite(lastCheckedMs)) {
    return true
  }
  return Date.now() - lastCheckedMs >= ANTHROPIC_BATCH_STATUS_POLL_INTERVAL_MS
}

async function markBatchJobError({
  supabase,
  jobId,
  error,
}: {
  supabase: AdminSupabaseClient
  jobId: string
  error: string
}) {
  const errorUpdate: ChatGenerationJobUpdate = {
    status: 'error',
    error,
    external_provider_last_checked_at: new Date().toISOString(),
  }
  await supabase
    .from('chat_generation_jobs')
    .update(errorUpdate as never)
    .eq('id', jobId)
}

async function decryptSecret({
  supabase,
  secretName,
  requester,
}: {
  supabase: AdminSupabaseClient
  secretName: string
  requester: string
}): Promise<string> {
  const rpcArgs: Database['public']['Functions']['get_decrypted_secret']['Args'] = {
    secret_name: secretName,
    requester,
  }
  const adminRpc = supabase as unknown as VaultRpcClient
  const { data, error } = await adminRpc.rpc('get_decrypted_secret', rpcArgs)

  if (error) {
    console.error('[Chat Job Runner] Vault decryption RPC failed', {
      secretName,
      requester,
      errorCode: error.code,
      errorMessage: error.message,
      errorDetails: error.details,
    })
    throw new Error(
      `Failed to decrypt API key: ${error.message || error.code || 'Unknown RPC error'}`,
    )
  }

  if (!data) {
    console.error('[Chat Job Runner] Vault decryption returned empty', {
      secretName,
      requester,
    })
    throw new Error(
      'API key decryption returned empty result. Secret may have been deleted or access denied.',
    )
  }
  return data
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}
