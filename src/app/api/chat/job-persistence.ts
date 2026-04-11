import type { ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { serializeChatJobPayload } from '@/lib/chat/job-payload'
import { MESSAGE_STATUS_COMPLETED } from '@/lib/chat/message-status'
import { ConcurrentChatTurnConflictError, createChatTurn } from '@/lib/chat/turns'
import { isChatJobUserLimitViolation, isUniqueViolation } from '@/lib/queue/admission'
import { createClient } from '@/lib/supabase/server'
import {
  PersistenceRollbackError,
  rollbackPersistedChatTurn,
  rollbackPersistedUserMessage,
} from './persistence-rollback'

type RouteSupabaseClient = Awaited<ReturnType<typeof createClient>>

type PersistUserTurnResult =
  | {
      status: 'success'
      turnId: string
      userMessageId: string
    }
  | {
      status: 'conflict'
    }
  | {
      status: 'error'
      responseMessage:
        | 'Failed to create chat turn'
        | 'Failed to save user message'
        | 'Failed to rollback persisted chat data'
    }

type EnqueueChatGenerationJobResult =
  | {
      status: 'success'
      jobId: string
    }
  | {
      status: 'conflict'
    }
  | {
      status: 'user-limit'
    }
  | {
      status: 'error'
      responseMessage: 'Failed to queue chat response' | 'Failed to rollback persisted chat data'
    }

async function rollbackPersistedChatData({
  supabase,
  chatId,
  requestId,
  insertedTurnId,
  insertedUserMessageId,
  isRegeneration,
}: {
  supabase: RouteSupabaseClient
  chatId: string
  requestId: string
  insertedTurnId: string | null
  insertedUserMessageId: string | null
  isRegeneration: boolean
}): Promise<void> {
  if (insertedTurnId && !isRegeneration) {
    await rollbackPersistedChatTurn(supabase, insertedTurnId, chatId, requestId)
    return
  }

  if (insertedUserMessageId) {
    await rollbackPersistedUserMessage(supabase, insertedUserMessageId, chatId, requestId)
  }
}

export async function persistUserTurn({
  supabase,
  chatId,
  userId,
  requestId,
  content,
}: {
  supabase: RouteSupabaseClient
  chatId: string
  userId: string
  requestId: string
  content: string
}): Promise<PersistUserTurnResult> {
  const userMessageId = crypto.randomUUID()
  const turnId = crypto.randomUUID()

  try {
    await createChatTurn({
      supabase,
      chatId,
      userId,
      turnId,
      userMessageId,
    })
  } catch (turnError) {
    if (turnError instanceof ConcurrentChatTurnConflictError) {
      console.warn('[Chat API] Concurrent chat turn admission conflict', {
        chatId,
        requestId,
      })
      return { status: 'conflict' }
    }

    console.error('[Chat API] Failed to create chat turn', {
      chatId,
      requestId,
      error: turnError instanceof Error ? turnError.message : String(turnError),
    })
    return { status: 'error', responseMessage: 'Failed to create chat turn' }
  }

  const { data: insertedMessage, error: insertUserError } = await supabase
    .from('messages')
    .insert({
      id: userMessageId,
      chat_id: chatId,
      role: 'user',
      content,
      turn_id: turnId,
      user_id: userId,
      message_status: MESSAGE_STATUS_COMPLETED,
    })
    .select('id')
    .single()

  if (insertUserError || !insertedMessage) {
    try {
      await rollbackPersistedChatTurn(supabase, turnId, chatId, requestId)
    } catch (rollbackError) {
      console.error('[Chat API] Failed to persist user message and rollback chat turn', {
        chatId,
        requestId,
        insertError: insertUserError?.message,
        rollbackError:
          rollbackError instanceof PersistenceRollbackError
            ? rollbackError.message
            : rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
      })
      return { status: 'error', responseMessage: 'Failed to rollback persisted chat data' }
    }

    console.error('[Chat API] Failed to persist user message', {
      chatId,
      requestId,
      error: insertUserError?.message,
    })
    return { status: 'error', responseMessage: 'Failed to save user message' }
  }

  return {
    status: 'success',
    turnId,
    userMessageId: insertedMessage.id,
  }
}

export async function enqueueChatGenerationJob({
  supabase,
  chatId,
  userId,
  requestId,
  payload,
  insertedTurnId,
  insertedUserMessageId,
}: {
  supabase: RouteSupabaseClient
  chatId: string
  userId: string
  requestId: string
  payload: ChatGenerationJobPayload
  insertedTurnId: string | null
  insertedUserMessageId: string | null
}): Promise<EnqueueChatGenerationJobResult> {
  const { data: job, error: jobError } = await supabase
    .from('chat_generation_jobs')
    .insert({
      chat_id: chatId,
      user_id: userId,
      status: 'pending',
      delivery_mode: payload.deliveryMode,
      payload: serializeChatJobPayload(payload),
    })
    .select('id')
    .single()

  if (jobError || !job) {
    try {
      await rollbackPersistedChatData({
        supabase,
        chatId,
        requestId,
        insertedTurnId,
        insertedUserMessageId,
        isRegeneration: payload.isRegeneration,
      })
    } catch (rollbackError) {
      console.error('[Chat API] Failed to rollback persisted chat data after job enqueue failure', {
        chatId,
        requestId,
        enqueueError: jobError?.message,
        rollbackError:
          rollbackError instanceof PersistenceRollbackError
            ? rollbackError.message
            : rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
      })
      return { status: 'error', responseMessage: 'Failed to rollback persisted chat data' }
    }

    if (isUniqueViolation(jobError)) {
      return { status: 'conflict' }
    }

    if (isChatJobUserLimitViolation(jobError)) {
      return { status: 'user-limit' }
    }

    console.error('[Chat API] Failed to enqueue chat generation job', {
      chatId,
      requestId,
      error: jobError?.message,
    })
    return { status: 'error', responseMessage: 'Failed to queue chat response' }
  }

  return { status: 'success', jobId: job.id }
}
