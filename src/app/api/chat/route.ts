import { createClient } from '@/lib/supabase/server'
import { resolveActiveLlmConfigForUser } from '@/lib/chat/llm-config-resolver'
import { checkUserRateLimit, checkAnonRateLimit } from '@/lib/chat/rate-limiter'
import { CHAT_REQUEST_LIMITS } from '@/lib/chat/runtime-limits'
import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
  isAnthropicBatchChatEnabled,
  isAnthropicBatchChatSupported,
  isChatDeliveryMode,
} from '@/lib/chat/delivery-mode'
import { NextResponse } from 'next/server'
import { ensureChatRequestAdmission, resolveRegenerationTargetTurnId } from './chat-admission'
import { parseChatRequest } from './request-contract'
import { extractClientIdentifier, parseDeclaredContentLength } from './request-metadata'
import { createErrorResponse } from './responses'
import { submitChatGenerationRequest } from './submit-chat-job'

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
    const { payloadSanitizedMessages } = parsedRequest.value

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
    const submissionResult = await submitChatGenerationRequest({
      supabase,
      requestId,
      chatId,
      userId: user.id,
      apiKeyId,
      provider,
      modelName,
      deliveryMode,
      isRegeneration,
      regenerateAssistantMessageId,
      targetTurnId,
      messageToPersist,
      normalizedUserMessage,
      payloadSanitizedMessages,
      logDebug: logChatApiDebug,
    })

    if (submissionResult.status === 'error') {
      return submissionResult.response
    }

    return NextResponse.json(
      {
        jobId: submissionResult.jobId,
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
