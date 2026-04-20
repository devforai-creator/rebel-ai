import type { SanitizedMessage } from '@/lib/chat-summaries'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import {
  ACTIVE_CHAT_JOB_CONFLICT_MESSAGE,
  buildActiveChatJobLimitMessage,
} from '@/lib/queue/admission'
import { createClient } from '@/lib/supabase/server'
import { scheduleChatJobRunnerTrigger } from './background-trigger'
import { enqueueChatGenerationJob, persistUserTurn } from './job-persistence'
import { dispatchPostSubmitChatEffects } from './post-submit-effects'
import { createErrorResponse } from './responses'

type RouteSupabaseClient = Awaited<ReturnType<typeof createClient>>

type SubmitChatGenerationRequestResult =
  | {
      status: 'success'
      jobId: string
    }
  | {
      status: 'error'
      response: Response
    }

export async function submitChatGenerationRequest({
  supabase,
  requestId,
  chatId,
  userId,
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
  logDebug,
}: {
  supabase: RouteSupabaseClient
  requestId: string
  chatId: string
  userId: string
  apiKeyId: string
  provider: ChatGenerationJobPayload['provider']
  modelName: string
  deliveryMode: ChatGenerationJobPayload['deliveryMode']
  isRegeneration: boolean
  regenerateAssistantMessageId: string | null
  targetTurnId: string | null
  messageToPersist: string | null
  normalizedUserMessage: string
  payloadSanitizedMessages: SanitizedMessage[]
  logDebug: (...args: unknown[]) => void
}): Promise<SubmitChatGenerationRequestResult> {
  let effectivePayloadSanitizedMessages = payloadSanitizedMessages
  let insertedUserMessageId: string | null = null
  let insertedTurnId: string | null = targetTurnId

  if (!isRegeneration) {
    if (!messageToPersist) {
      return {
        status: 'error',
        response: createErrorResponse('Invalid user message', 400),
      }
    }

    const persistResult = await persistUserTurn({
      supabase,
      chatId,
      userId,
      requestId,
      content: messageToPersist,
    })

    if (persistResult.status === 'conflict') {
      return {
        status: 'error',
        response: createErrorResponse(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, 409),
      }
    }

    if (persistResult.status === 'error') {
      return {
        status: 'error',
        response: createErrorResponse(persistResult.responseMessage, 500),
      }
    }

    insertedUserMessageId = persistResult.userMessageId
    insertedTurnId = persistResult.turnId

    if (normalizedUserMessage && insertedUserMessageId) {
      effectivePayloadSanitizedMessages = [
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
    userId,
    apiKeyId,
    provider,
    modelName,
    deliveryMode,
    sanitizedMessages: effectivePayloadSanitizedMessages,
    isRegeneration,
    regenerateAssistantMessageId,
  }

  const enqueueResult = await enqueueChatGenerationJob({
    supabase,
    chatId,
    userId,
    requestId,
    payload: jobPayload,
    insertedTurnId,
    insertedUserMessageId,
  })

  if (enqueueResult.status !== 'success') {
    if (enqueueResult.status === 'conflict') {
      return {
        status: 'error',
        response: createErrorResponse(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, 409),
      }
    }

    if (enqueueResult.status === 'user-limit') {
      return {
        status: 'error',
        response: createErrorResponse(buildActiveChatJobLimitMessage(), 429),
      }
    }

    return {
      status: 'error',
      response: createErrorResponse(enqueueResult.responseMessage, 500),
    }
  }

  const jobId = enqueueResult.jobId

  dispatchPostSubmitChatEffects({
    chatId,
    jobId,
    userId,
    insertedUserMessageId,
  })

  scheduleChatJobRunnerTrigger({
    chatId,
    jobId,
    requestId,
    logDebug,
  })

  return {
    status: 'success',
    jobId,
  }
}
