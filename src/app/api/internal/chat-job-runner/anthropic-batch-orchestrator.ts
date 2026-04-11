import { createAdminClient } from '@/lib/supabase/admin'
import type { ApiKey, Database } from '@/types/database.types'
import { parseChatJobPayload, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { resolveAnthropicCacheDecision, resolvePromptCacheDecision } from '@/lib/llm/prompt-cache'
import { estimateUsageCost } from '@/lib/model-pricing'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH } from '@/lib/chat/delivery-mode'
import {
  createAnthropicMessageBatch,
  extractTextFromAnthropicBatchMessage,
  retrieveAnthropicBatchResult,
  retrieveAnthropicMessageBatch,
  type AnthropicBatchMessageParams,
  type AnthropicTextBlock,
} from '@/lib/llm/anthropic-batch'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { buildStreamPayloadPlan } from './stream-payload-builder'
import { buildChatDebugInfo, type ChatRunnerActualPayload } from './usage-debug'
import { runPostGenerationPipeline } from './post-generation-pipeline'
import { decryptSecret } from './vault'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type ChatGenerationJobUpdate = Database['public']['Tables']['chat_generation_jobs']['Update']
type BatchApiKeyRow = Pick<ApiKey, 'vault_secret_name' | 'service_tier'>
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

export type AnthropicBatchJobMetadata = {
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

export async function submitAnthropicBatchJob({
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

export async function pollDueAnthropicBatchJobs({
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

  const cacheControl = extractAnthropicRequestCacheControl(streamPayloadPlan)
  const systemCacheControl: NonNullable<AnthropicTextBlock['cache_control']> = cacheControl ?? {
    type: 'ephemeral',
  }
  const systemBlocks = streamPayloadPlan.actualPayload.systemMessages.map<AnthropicTextBlock>(
    (message) => {
      const block: AnthropicTextBlock = {
        type: 'text',
        text: message.content,
      }

      if (message.cached) {
        block.cache_control = systemCacheControl
      }

      return block
    },
  )

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
