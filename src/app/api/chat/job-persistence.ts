import 'server-only'

import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { serializeChatJobPayload } from '@/lib/chat/job-payload'
import {
  getChatSubmissionValidationMessage,
  isActiveChatJobConflict,
  isChatJobUserLimitViolation,
  isChatSubmissionNotFound,
} from '@/lib/queue/admission'
import { createAdminClient } from '@/lib/supabase/admin'

type SubmitChatGenerationJobResult =
  | {
      status: 'success'
      jobId: string
      turnId: string
      userMessageId: string | null
    }
  | {
      status: 'conflict'
    }
  | {
      status: 'user-limit'
    }
  | {
      status: 'not-found'
    }
  | {
      status: 'invalid-regeneration'
      responseMessage:
        | 'Invalid regeneration target'
        | 'Only the latest assistant message can be regenerated'
    }
  | {
      status: 'error'
      responseMessage: 'Failed to queue chat response'
    }

export async function submitChatGenerationJobAtomically({
  chatId,
  userId,
  requestId,
  turnId,
  userMessageId,
  userMessageContent,
  payload,
}: {
  chatId: string
  userId: string
  requestId: string
  turnId: string | null
  userMessageId: string | null
  userMessageContent: string | null
  payload: ChatGenerationJobPayload
}): Promise<SubmitChatGenerationJobResult> {
  const adminSupabase = createAdminClient()
  const { data, error } = await adminSupabase.rpc('submit_chat_generation_job', {
    p_chat_id: chatId,
    p_requester: userId,
    p_turn_id: turnId,
    p_user_message_id: userMessageId,
    p_user_message_content: userMessageContent,
    p_job_payload: serializeChatJobPayload(payload),
    p_delivery_mode: payload.deliveryMode,
    p_is_regeneration: payload.isRegeneration,
    p_regenerate_assistant_message_id: payload.regenerateAssistantMessageId,
  })

  if (error) {
    if (isActiveChatJobConflict(error)) {
      return { status: 'conflict' }
    }

    if (isChatJobUserLimitViolation(error)) {
      return { status: 'user-limit' }
    }

    if (isChatSubmissionNotFound(error)) {
      return { status: 'not-found' }
    }

    const validationMessage = getChatSubmissionValidationMessage(error)
    if (validationMessage) {
      return {
        status: 'invalid-regeneration',
        responseMessage: validationMessage,
      }
    }

    console.error('[Chat API] Failed to submit chat generation job atomically', {
      chatId,
      requestId,
      error: error.message,
    })
    return { status: 'error', responseMessage: 'Failed to queue chat response' }
  }

  const submission = data?.[0]
  if (!submission?.job_id || !submission.turn_id) {
    console.error('[Chat API] Atomic chat submission returned no result', {
      chatId,
      requestId,
    })
    return { status: 'error', responseMessage: 'Failed to queue chat response' }
  }

  return {
    status: 'success',
    jobId: submission.job_id,
    turnId: submission.turn_id,
    userMessageId: submission.user_message_id,
  }
}
