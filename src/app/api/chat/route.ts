import { createClient } from '@/lib/supabase/server'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { checkUserRateLimit, checkAnonRateLimit } from '@/lib/chat/rate-limiter'
import {
  ACTIVE_CHAT_JOB_CONFLICT_MESSAGE,
  ACTIVE_QUEUE_JOB_STATUSES,
  MAX_ACTIVE_CHAT_JOBS_PER_USER,
  buildActiveChatJobLimitMessage,
} from '@/lib/queue/admission'
import { isLLMProvider } from '@/lib/api-keys/provider-utils'
import { getDefaultModelForProvider } from '@/lib/llm/default-model'
import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
  isAnthropicBatchChatSupported,
  isChatDeliveryMode,
} from '@/lib/chat/delivery-mode'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { z } from 'zod'
import { scheduleChatJobRunnerTrigger } from './background-trigger'
import { enqueueChatGenerationJob, persistUserTurn } from './job-persistence'
import { extractClientIdentifier, parseDeclaredContentLength } from './request-metadata'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 second timeout

// Increased to 256KB to support characters with large first message templates
// (e.g., RisuAI First Message Selector with multiple variations)
const MAX_MESSAGE_BYTES = 262_144 // 256KB per message
const MAX_CHAT_REQUEST_BODY_BYTES = 5_308_416 // ~5MB to cap parsing cost even when platform limits are loose
const CHAT_API_DEBUG_ENABLED = process.env.CHAT_API_DEBUG === 'true'

function logChatApiDebug(...args: unknown[]): void {
  if (CHAT_API_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

const chatRequestSchema = z
  .object({
    messages: z.array(z.unknown()).optional().nullable(),
    chatId: z.unknown().optional(),
    apiKeyId: z.unknown().optional(),
    deliveryMode: z.unknown().optional(),
    isRegeneration: z.unknown().optional(),
    regenerateAssistantMessageId: z.unknown().optional(),
  })
  .passthrough()

// Rate limiter utility is now imported from '@/lib/chat/rate-limiter'

export async function POST(req: Request) {
  try {
    const declaredContentLength = parseDeclaredContentLength(req.headers.get('content-length'))
    if (
      typeof declaredContentLength === 'number' &&
      declaredContentLength > MAX_CHAT_REQUEST_BODY_BYTES
    ) {
      return new Response('Request body exceeds allowed size', { status: 413 })
    }

    const supabase = await createClient()
    const requestId = crypto.randomUUID()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      const clientIdentifier = await extractClientIdentifier(req)
      const { allowed, retryAfter } = await checkAnonRateLimit(clientIdentifier)

      if (!allowed) {
        return new Response(
          JSON.stringify({
            error: 'Too many requests',
            retryAfter,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(retryAfter),
            },
          },
        )
      }

      return new Response('Unauthorized', { status: 401 })
    }

    const { allowed, retryAfter } = await checkUserRateLimit(user.id)

    if (!allowed) {
      return new Response(
        JSON.stringify({
          error: 'Rate limit exceeded',
          retryAfter,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(retryAfter ?? 60),
          },
        },
      )
    }

    const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null))

    if (!parsed.success) {
      return new Response('Invalid request body', { status: 400 })
    }

    const {
      messages,
      chatId,
      apiKeyId,
      deliveryMode: rawDeliveryMode,
      isRegeneration: rawIsRegeneration,
      regenerateAssistantMessageId: rawRegenerateAssistantMessageId,
    } = parsed.data

    if (typeof chatId !== 'string' || !chatId) {
      return new Response('Invalid chatId', { status: 400 })
    }

    if (typeof apiKeyId !== 'string' || !apiKeyId) {
      return new Response('Invalid apiKeyId', { status: 400 })
    }

    const sanitizedMessages: SanitizedMessage[] = Array.isArray(messages)
      ? messages
          .filter((message): message is { role: string; content: string } => {
            if (!message || typeof message !== 'object') {
              return false
            }
            const candidate = message as Record<string, unknown>
            return typeof candidate.role === 'string' && typeof candidate.content === 'string'
          })
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => {
            const candidate = message as Record<string, unknown>
            return {
              role: message.role as 'user' | 'assistant',
              content: message.content,
              messageId: typeof candidate.messageId === 'string' ? candidate.messageId : null,
            }
          })
      : []

    const regenerateAssistantMessageId =
      typeof rawRegenerateAssistantMessageId === 'string' &&
      rawRegenerateAssistantMessageId.trim().length > 0
        ? rawRegenerateAssistantMessageId
        : null

    const isRegeneration = rawIsRegeneration === true || regenerateAssistantMessageId !== null
    const textEncoder = new TextEncoder()

    if (isRegeneration && !regenerateAssistantMessageId) {
      return new Response('regenerateAssistantMessageId is required', { status: 400 })
    }

    if (!isRegeneration) {
      if (sanitizedMessages.length === 0) {
        return new Response('Messages array required', { status: 400 })
      }

      const lastMessage = sanitizedMessages[sanitizedMessages.length - 1]
      if (lastMessage.role !== 'user' || !lastMessage.content.trim()) {
        return new Response('Last message must be a non-empty user message', { status: 400 })
      }

      const byteLength = textEncoder.encode(lastMessage.content).length
      if (byteLength > MAX_MESSAGE_BYTES) {
        return new Response('Message exceeds allowed size', { status: 400 })
      }
    }

    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('id, provider, model_preference')
      .eq('id', apiKeyId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (apiKeyError || !apiKeyData) {
      return new Response('API key not found or inactive', { status: 404 })
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, user_id, character_id, persona_id, max_context_messages')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      return new Response('Chat not found', { status: 404 })
    }

    const [existingActiveJobResult, activeUserJobsResult] = await Promise.all([
      supabase
        .from('chat_generation_jobs')
        .select('id, status')
        .eq('chat_id', chatId)
        .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
        .limit(1),
      supabase
        .from('chat_generation_jobs')
        .select('id')
        .eq('user_id', user.id)
        .in('status', [...ACTIVE_QUEUE_JOB_STATUSES]),
    ])

    if (existingActiveJobResult.error) {
      console.error('[Chat API] Failed to check active chat job', {
        chatId,
        requestId,
        error: existingActiveJobResult.error.message,
      })
      return new Response('Failed to inspect active chat jobs', { status: 500 })
    }

    if ((existingActiveJobResult.data?.length ?? 0) > 0) {
      return new Response(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, { status: 409 })
    }

    if (activeUserJobsResult.error) {
      console.error('[Chat API] Failed to count active user jobs', {
        chatId,
        requestId,
        error: activeUserJobsResult.error.message,
      })
      return new Response('Failed to inspect active chat jobs', { status: 500 })
    }

    if ((activeUserJobsResult.data?.length ?? 0) >= MAX_ACTIVE_CHAT_JOBS_PER_USER) {
      return new Response(buildActiveChatJobLimitMessage(), { status: 429 })
    }

    let targetTurnId: string | null = null

    if (regenerateAssistantMessageId) {
      const [
        { data: targetTurn, error: targetTurnError },
        { data: latestTurn, error: latestTurnError },
      ] = await Promise.all([
        supabase
          .from('chat_turns')
          .select('id, turn_index, active_assistant_message_id')
          .eq('chat_id', chatId)
          .eq('active_assistant_message_id', regenerateAssistantMessageId)
          .single(),
        supabase
          .from('chat_turns')
          .select('id, turn_index')
          .eq('chat_id', chatId)
          .order('turn_index', { ascending: false })
          .limit(1)
          .single(),
      ])

      if (targetTurnError || !targetTurn || latestTurnError || !latestTurn) {
        console.warn('[Chat API] Invalid regeneration target', {
          chatId,
          requestId,
          targetId: regenerateAssistantMessageId,
        })
        return new Response('Invalid regeneration target', { status: 400 })
      }

      if (latestTurn.id !== targetTurn.id) {
        return new Response('Only the latest assistant message can be regenerated', {
          status: 400,
        })
      }

      targetTurnId = targetTurn.id
    }

    if (!isLLMProvider(apiKeyData.provider)) {
      return new Response('Unsupported provider', { status: 400 })
    }

    const provider = apiKeyData.provider
    const modelName = apiKeyData.model_preference || getDefaultModelForProvider(provider)
    const deliveryMode = isChatDeliveryMode(rawDeliveryMode)
      ? rawDeliveryMode
      : CHAT_DELIVERY_MODE_STREAMING

    if (
      deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH &&
      !isAnthropicBatchChatSupported({ provider, modelName })
    ) {
      return new Response('Claude Batch mode is only supported for Anthropic Opus 4.5/4.6', {
        status: 400,
      })
    }

    let insertedUserMessageId: string | null = null
    let insertedTurnId: string | null = targetTurnId

    if (!isRegeneration) {
      const userMessage = sanitizedMessages[sanitizedMessages.length - 1]

      if (userMessage?.role !== 'user' || !userMessage.content.trim()) {
        return new Response('Invalid user message', { status: 400 })
      }

      const persistResult = await persistUserTurn({
        supabase,
        chatId,
        userId: user.id,
        requestId,
        content: userMessage.content,
      })

      if (persistResult.status === 'conflict') {
        return new Response(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, { status: 409 })
      }

      if (persistResult.status === 'error') {
        return new Response(persistResult.responseMessage, { status: 500 })
      }

      insertedUserMessageId = persistResult.userMessageId
      insertedTurnId = persistResult.turnId
    }

    const jobPayload: ChatGenerationJobPayload = {
      version: CHAT_JOB_PAYLOAD_VERSION,
      requestId,
      chatId,
      turnId: insertedTurnId,
      userId: user.id,
      apiKeyId,
      provider,
      modelName,
      deliveryMode,
      sanitizedMessages,
      isRegeneration,
      regenerateAssistantMessageId,
    }

    const enqueueResult = await enqueueChatGenerationJob({
      supabase,
      chatId,
      userId: user.id,
      requestId,
      payload: jobPayload,
      insertedTurnId,
      insertedUserMessageId,
    })

    if (enqueueResult.status !== 'success') {
      if (enqueueResult.status === 'conflict') {
        return new Response(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, { status: 409 })
      }

      if (enqueueResult.status === 'user-limit') {
        return new Response(buildActiveChatJobLimitMessage(), { status: 429 })
      }

      return new Response('Failed to queue chat response', { status: 500 })
    }

    const jobId = enqueueResult.jobId

    if (insertedUserMessageId) {
      // Fire-and-forget: trigger background translation for user message
      triggerMessageTranslation(insertedUserMessageId, user.id)
    }

    scheduleChatJobRunnerTrigger({
      chatId,
      jobId,
      requestId,
      logDebug: logChatApiDebug,
    })

    return new Response(
      JSON.stringify({
        jobId,
        requestId,
      }),
      {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  } catch (error) {
    // Note: chatId/requestId may not be available if error occurs early in the flow
    console.error('[Chat API] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return new Response('Internal server error', { status: 500 })
  }
}
