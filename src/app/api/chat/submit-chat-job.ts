import type { SanitizedMessage } from '@/lib/chat-summaries'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import {
  ACTIVE_CHAT_JOB_CONFLICT_MESSAGE,
  buildActiveChatJobLimitMessage,
} from '@/lib/queue/admission'
import { scheduleChatJobRunnerTrigger } from './background-trigger'
import { submitChatGenerationJobAtomically } from './job-persistence'
import { dispatchPostSubmitChatEffects } from './post-submit-effects'
import { createErrorResponse } from './responses'

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
  requestId,
  chatId,
  userId,
  apiKeyId,
  provider,
  modelName,
  deliveryMode,
  isRegeneration,
  regenerateAssistantMessageId,
  messageToPersist,
  normalizedUserMessage,
  payloadSanitizedMessages,
  logDebug,
}: {
  requestId: string
  chatId: string
  userId: string
  apiKeyId: string
  provider: ChatGenerationJobPayload['provider']
  modelName: string
  deliveryMode: ChatGenerationJobPayload['deliveryMode']
  isRegeneration: boolean
  regenerateAssistantMessageId: string | null
  messageToPersist: string | null
  normalizedUserMessage: string
  payloadSanitizedMessages: SanitizedMessage[]
  logDebug: (...args: unknown[]) => void
}): Promise<SubmitChatGenerationRequestResult> {
  let effectivePayloadSanitizedMessages = payloadSanitizedMessages
  const insertedUserMessageId = isRegeneration ? null : crypto.randomUUID()
  const insertedTurnId = isRegeneration ? null : crypto.randomUUID()

  if (!isRegeneration) {
    if (!messageToPersist) {
      return {
        status: 'error',
        response: createErrorResponse('Invalid user message', 400),
      }
    }

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

  const submissionResult = await submitChatGenerationJobAtomically({
    chatId,
    userId,
    requestId,
    turnId: insertedTurnId,
    userMessageId: insertedUserMessageId,
    userMessageContent: isRegeneration ? null : messageToPersist,
    payload: jobPayload,
  })

  if (submissionResult.status !== 'success') {
    if (submissionResult.status === 'conflict') {
      return {
        status: 'error',
        response: createErrorResponse(ACTIVE_CHAT_JOB_CONFLICT_MESSAGE, 409),
      }
    }

    if (submissionResult.status === 'user-limit') {
      return {
        status: 'error',
        response: createErrorResponse(buildActiveChatJobLimitMessage(), 429),
      }
    }

    if (submissionResult.status === 'not-found') {
      return {
        status: 'error',
        response: createErrorResponse('Chat not found', 404),
      }
    }

    if (submissionResult.status === 'invalid-regeneration') {
      return {
        status: 'error',
        response: createErrorResponse(submissionResult.responseMessage, 400),
      }
    }

    return {
      status: 'error',
      response: createErrorResponse(submissionResult.responseMessage, 500),
    }
  }

  const jobId = submissionResult.jobId

  dispatchPostSubmitChatEffects({
    chatId,
    jobId,
    userId,
    insertedUserMessageId: submissionResult.userMessageId,
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
