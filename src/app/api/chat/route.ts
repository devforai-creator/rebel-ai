import { createClient } from '@/lib/supabase/server'
import { resolveActiveLlmConfigForUser } from '@/lib/chat/llm-config-resolver'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { checkUserRateLimit, checkAnonRateLimit } from '@/lib/chat/rate-limiter'
import { CHAT_REQUEST_LIMITS } from '@/lib/chat/runtime-limits'
import {
  ACTIVE_CHAT_JOB_CONFLICT_MESSAGE,
  buildActiveChatJobLimitMessage,
} from '@/lib/queue/admission'
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
import { ensureChatRequestAdmission, resolveRegenerationTargetTurnId } from './chat-admission'
import { scheduleChatJobRunnerTrigger } from './background-trigger'
import { enqueueChatGenerationJob, persistUserTurn } from './job-persistence'
import { parseChatRequest } from './request-contract'
import { extractClientIdentifier, parseDeclaredContentLength } from './request-metadata'
import { createErrorResponse } from './responses'

export const runtime = 'nodejs'
export const maxDuration = 60 // 60 second timeout

const CHAT_API_DEBUG_ENABLED = process.env.CHAT_API_DEBUG === 'true'

function logChatApiDebug(...args: unknown[]): void {
  if (CHAT_API_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

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

    const parsedRequest = await parseChatRequest({
      req,
      requestId,
    })

    if (parsedRequest.status === 'error') {
      return parsedRequest.response
    }

    const {
      chatId,
      apiKeyId,
      rawDeliveryMode,
      isRegeneration,
      regenerateAssistantMessageId,
      normalizedUserMessage,
      messageToPersist,
    } = parsedRequest.value
    let { payloadSanitizedMessages } = parsedRequest.value

    const resolvedConfig = await resolveActiveLlmConfigForUser({
      supabase,
      userId: user.id,
      apiKeyId,
    })

    if (resolvedConfig.status === 'missing_api_key') {
      return createErrorResponse('API key not found or inactive', 404)
    }

    const admissionResult = await ensureChatRequestAdmission({
      supabase,
      chatId,
      userId: user.id,
      requestId,
    })

    if (admissionResult.status === 'error') {
      return admissionResult.response
    }

    const regenerationTarget = await resolveRegenerationTargetTurnId({
      supabase,
      chatId,
      regenerateAssistantMessageId,
      requestId,
    })

    if (regenerationTarget.status === 'error') {
      return regenerationTarget.response
    }

    const targetTurnId = regenerationTarget.turnId

    if (resolvedConfig.status === 'unsupported_provider') {
      return createErrorResponse('Unsupported provider', 400)
    }

    const { provider, modelName } = resolvedConfig.config
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
