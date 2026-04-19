import { createClient } from '@/lib/supabase/server'
import type { SanitizedMessage } from '@/lib/chat-summaries'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { checkUserRateLimit, checkAnonRateLimit } from '@/lib/chat/rate-limiter'
import { CHAT_REQUEST_LIMITS } from '@/lib/chat/runtime-limits'
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
  isAnthropicBatchChatEnabled,
  isAnthropicBatchChatSupported,
  isChatDeliveryMode,
} from '@/lib/chat/delivery-mode'
import { triggerMessageTranslation } from '@/lib/chat/translation-trigger'
import { dispatchNonBlockingSupportEffect, SUPPORT_TIER_FEATURES } from '@/lib/support-tier'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { scheduleChatJobRunnerTrigger } from './background-trigger'
import { enqueueChatGenerationJob, persistUserTurn } from './job-persistence'
import { extractClientIdentifier, parseDeclaredContentLength } from './request-metadata'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 second timeout

const CHAT_API_DEBUG_ENABLED = process.env.CHAT_API_DEBUG === 'true'

function logChatApiDebug(...args: unknown[]): void {
  if (CHAT_API_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

function createErrorResponse(
  message: string,
  status: number,
  options?: {
    retryAfter?: number | null
    headers?: HeadersInit
  },
) {
  const body: {
    error: string
    retryAfter?: number | null
  } = { error: message }

  if (options && 'retryAfter' in options) {
    body.retryAfter = options.retryAfter ?? null
  }

  return NextResponse.json(body, {
    status,
    headers: options?.headers,
  })
}

const chatRequestSchema = z
  .object({
    messages: z.array(z.unknown()).optional().nullable(),
    userMessage: z.unknown().optional(),
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
      declaredContentLength > CHAT_REQUEST_LIMITS.maxRequestBodyBytes
    ) {
      return createErrorResponse('Request body exceeds allowed size', 413)
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
        return createErrorResponse('Too many requests', 429, {
          retryAfter,
          headers: {
            'Retry-After': String(retryAfter),
          },
        })
      }

      return createErrorResponse('Unauthorized', 401)
    }

    const { allowed, retryAfter } = await checkUserRateLimit(user.id)

    if (!allowed) {
      return createErrorResponse('Rate limit exceeded', 429, {
        retryAfter,
        headers: {
          'Retry-After': String(retryAfter ?? 60),
        },
      })
    }

    const parsed = chatRequestSchema.safeParse(await req.json().catch(() => null))

    if (!parsed.success) {
      return createErrorResponse('Invalid request body', 400)
    }

    const {
      messages,
      userMessage: rawUserMessage,
      chatId,
      apiKeyId,
      deliveryMode: rawDeliveryMode,
      isRegeneration: rawIsRegeneration,
      regenerateAssistantMessageId: rawRegenerateAssistantMessageId,
    } = parsed.data

    if (typeof chatId !== 'string' || !chatId) {
      return createErrorResponse('Invalid chatId', 400)
    }

    if (typeof apiKeyId !== 'string' || !apiKeyId) {
      return createErrorResponse('Invalid apiKeyId', 400)
    }

    const sanitizedMessagesFromRequest: SanitizedMessage[] = Array.isArray(messages)
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

    const normalizedUserMessage = typeof rawUserMessage === 'string' ? rawUserMessage.trim() : ''

    const regenerateAssistantMessageId =
      typeof rawRegenerateAssistantMessageId === 'string' &&
      rawRegenerateAssistantMessageId.trim().length > 0
        ? rawRegenerateAssistantMessageId
        : null

    const isRegeneration = rawIsRegeneration === true || regenerateAssistantMessageId !== null
    const textEncoder = new TextEncoder()
    let messageToPersist: string | null = null
    let payloadSanitizedMessages = sanitizedMessagesFromRequest

    if (isRegeneration && !regenerateAssistantMessageId) {
      return createErrorResponse('regenerateAssistantMessageId is required', 400)
    }

    if (!isRegeneration) {
      if (normalizedUserMessage) {
        const byteLength = textEncoder.encode(normalizedUserMessage).length
        if (byteLength > CHAT_REQUEST_LIMITS.maxMessageBytes) {
          return createErrorResponse('Message exceeds allowed size', 400)
        }

        messageToPersist = normalizedUserMessage
        payloadSanitizedMessages = [
          {
            role: 'user',
            content: normalizedUserMessage,
            messageId: null,
          },
        ]
      } else {
        // Temporary compatibility path for legacy callers that still send a client-built
        // transcript body. Remove this once /api/chat callers have fully migrated to the
        // slim userMessage / regenerateAssistantMessageId request contract.
        if (sanitizedMessagesFromRequest.length === 0) {
          return createErrorResponse('Messages array required', 400)
        }

        const lastMessage = sanitizedMessagesFromRequest[sanitizedMessagesFromRequest.length - 1]
        if (lastMessage.role !== 'user' || !lastMessage.content.trim()) {
          return createErrorResponse('Last message must be a non-empty user message', 400)
        }

        const byteLength = textEncoder.encode(lastMessage.content).length
        if (byteLength > CHAT_REQUEST_LIMITS.maxMessageBytes) {
          return createErrorResponse('Message exceeds allowed size', 400)
        }

        messageToPersist = lastMessage.content
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
      return createErrorResponse('API key not found or inactive', 404)
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, user_id, character_id, persona_id, max_context_messages')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      return createErrorResponse('Chat not found', 404)
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
      return createErrorResponse('Failed to inspect active chat jobs', 500)
    }

    if ((existingActiveJobResult.data?.length ?? 0) > 0) {
      return createErrorResponse(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, 409)
    }

    if (activeUserJobsResult.error) {
      console.error('[Chat API] Failed to count active user jobs', {
        chatId,
        requestId,
        error: activeUserJobsResult.error.message,
      })
      return createErrorResponse('Failed to inspect active chat jobs', 500)
    }

    if ((activeUserJobsResult.data?.length ?? 0) >= MAX_ACTIVE_CHAT_JOBS_PER_USER) {
      return createErrorResponse(buildActiveChatJobLimitMessage(), 429)
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
        return createErrorResponse('Invalid regeneration target', 400)
      }

      if (latestTurn.id !== targetTurn.id) {
        return createErrorResponse('Only the latest assistant message can be regenerated', 400)
      }

      targetTurnId = targetTurn.id
    }

    if (!isLLMProvider(apiKeyData.provider)) {
      return createErrorResponse('Unsupported provider', 400)
    }

    const provider = apiKeyData.provider
    const modelName = apiKeyData.model_preference || getDefaultModelForProvider(provider)
    const deliveryMode = isChatDeliveryMode(rawDeliveryMode)
      ? rawDeliveryMode
      : CHAT_DELIVERY_MODE_STREAMING

    if (deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH) {
      if (!isAnthropicBatchChatEnabled()) {
        return createErrorResponse('Claude Batch mode is disabled for this deployment', 400)
      }

      if (!isAnthropicBatchChatSupported({ provider, modelName })) {
        return createErrorResponse(
          'Claude Batch mode is only supported for Anthropic Opus 4.5/4.6',
          400,
        )
      }
    }

    let insertedUserMessageId: string | null = null
    let insertedTurnId: string | null = targetTurnId

    if (!isRegeneration) {
      if (!messageToPersist) {
        return createErrorResponse('Invalid user message', 400)
      }

      const persistResult = await persistUserTurn({
        supabase,
        chatId,
        userId: user.id,
        requestId,
        content: messageToPersist,
      })

      if (persistResult.status === 'conflict') {
        return createErrorResponse(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, 409)
      }

      if (persistResult.status === 'error') {
        return createErrorResponse(persistResult.responseMessage, 500)
      }

      insertedUserMessageId = persistResult.userMessageId
      insertedTurnId = persistResult.turnId

      if (normalizedUserMessage && insertedUserMessageId) {
        payloadSanitizedMessages = [
          {
            role: 'user',
            content: messageToPersist,
            messageId: insertedUserMessageId,
          },
        ]
      }
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
      sanitizedMessages: payloadSanitizedMessages,
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
        return createErrorResponse(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, 409)
      }

      if (enqueueResult.status === 'user-limit') {
        return createErrorResponse(buildActiveChatJobLimitMessage(), 429)
      }

      return createErrorResponse(enqueueResult.responseMessage, 500)
    }

    const jobId = enqueueResult.jobId

    if (insertedUserMessageId) {
      dispatchNonBlockingSupportEffect({
        feature: SUPPORT_TIER_FEATURES.MESSAGE_TRANSLATION_TRIGGER,
        execute: () => triggerMessageTranslation(insertedUserMessageId, user.id),
        context: {
          chatId,
          jobId,
          messageId: insertedUserMessageId,
          userId: user.id,
        },
        logPrefix: '[Chat API]',
      })
    }

    scheduleChatJobRunnerTrigger({
      chatId,
      jobId,
      requestId,
      logDebug: logChatApiDebug,
    })

    return NextResponse.json(
      {
        jobId,
        requestId,
      },
      { status: 202 },
    )
  } catch (error) {
    // Note: chatId/requestId may not be available if error occurs early in the flow
    console.error('[Chat API] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return createErrorResponse('Internal server error', 500)
  }
}
