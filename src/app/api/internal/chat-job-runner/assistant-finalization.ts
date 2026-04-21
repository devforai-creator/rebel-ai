import type { createAdminClient } from '@/lib/supabase/admin'
import type { Json, Message, MessageInsert, MessageUpdate } from '@/types/database.types'
import {
  MESSAGE_STATUS_COMPLETED,
  MESSAGE_STATUS_GENERATING,
  MESSAGE_STATUS_SUPERSEDED,
} from '@/lib/chat/message-status'

type AdminSupabaseClient = ReturnType<typeof createAdminClient>
type MessageIdRow = Pick<Message, 'id'>
type TurnStateRow = {
  id: string
  active_assistant_message_id: string | null
}
type AssistantVariantRow = {
  id: string
  variant_index: number | null
}

export type FinalizeAssistantMessageArgs = {
  supabase: AdminSupabaseClient
  chatId: string
  userId: string
  assistantText: string
  assistantMessageId: string | null
  turnId: string | null
  regenerateAssistantMessageId: string | null
  promptTokens: number | null
  completionTokens: number | null
  debugInfo: Record<string, unknown>
  modelName: string
  messageInsertDuration: number | null
  now: () => number
}

export type FinalizeAssistantMessageResult = {
  assistantMessageId: string
  messageInsertDuration: number | null
}

export async function finalizeAssistantMessage({
  supabase,
  chatId,
  userId,
  assistantText,
  assistantMessageId,
  turnId,
  regenerateAssistantMessageId,
  promptTokens,
  completionTokens,
  debugInfo,
  modelName,
  messageInsertDuration,
  now,
}: FinalizeAssistantMessageArgs): Promise<FinalizeAssistantMessageResult> {
  if (regenerateAssistantMessageId && !turnId) {
    throw new Error('Regeneration without turn state is no longer supported')
  }

  let finalAssistantMessageId = assistantMessageId
  let finalMessageInsertDuration = messageInsertDuration
  let previousActiveAssistantId: string | null = null
  let nextVariantIndex: number | null = null
  let insertedAssistantInPipeline = false
  let activeAssistantPointerUpdated = false
  let previousAssistantSuperseded = false

  if (turnId) {
    const { data: turnState, error: turnStateError } = await supabase
      .from('chat_turns')
      .select('id, active_assistant_message_id')
      .eq('id', turnId)
      .eq('chat_id', chatId)
      .single<TurnStateRow>()

    if (turnStateError || !turnState) {
      throw new Error('Failed to load chat turn for assistant finalization')
    }

    previousActiveAssistantId = turnState.active_assistant_message_id
    if (
      regenerateAssistantMessageId &&
      previousActiveAssistantId !== regenerateAssistantMessageId
    ) {
      throw new Error('Regeneration target is no longer the active assistant message')
    }

    const { data: latestVariant, error: latestVariantError } = await supabase
      .from('messages')
      .select('id, variant_index')
      .eq('turn_id', turnId)
      .eq('role', 'assistant')
      .order('variant_index', { ascending: false })
      .limit(1)
      .maybeSingle<AssistantVariantRow>()

    if (latestVariantError && latestVariantError.code !== 'PGRST116') {
      throw new Error('Failed to load current assistant variants for turn')
    }

    nextVariantIndex = (latestVariant?.variant_index ?? 0) + 1
  }

  if (!finalAssistantMessageId) {
    const insertStart = now()
    const messageInsert: MessageInsert = {
      chat_id: chatId,
      role: 'assistant',
      content: assistantText,
      model_used: modelName,
      turn_id: turnId,
      variant_index: nextVariantIndex,
      supersedes_message_id: previousActiveAssistantId,
      message_status: turnId ? MESSAGE_STATUS_GENERATING : MESSAGE_STATUS_COMPLETED,
      user_id: userId,
    }
    const { data: insertedMessage, error: messageInsertError } = await supabase
      .from('messages')
      .insert(messageInsert as never)
      .select('id')
      .single<MessageIdRow>()

    finalMessageInsertDuration = now() - insertStart

    if (messageInsertError || !insertedMessage) {
      throw new Error('Failed to insert assistant message')
    }

    finalAssistantMessageId = insertedMessage.id
    insertedAssistantInPipeline = true
  }

  if (!finalAssistantMessageId) {
    throw new Error('Failed to resolve assistant message id')
  }

  try {
    const assistantFinalizeUpdate: MessageUpdate = {
      content: assistantText,
      model_used: modelName,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      debug_info: debugInfo as Json,
      turn_id: turnId,
      variant_index: nextVariantIndex,
      supersedes_message_id: previousActiveAssistantId,
      message_status: MESSAGE_STATUS_COMPLETED,
      user_id: userId,
    }
    const { error: assistantFinalizeError } = await supabase
      .from('messages')
      .update(assistantFinalizeUpdate as never)
      .eq('id', finalAssistantMessageId)
      .eq('chat_id', chatId)

    if (assistantFinalizeError) {
      throw new Error(
        `Failed to update assistant message content: ${assistantFinalizeError.message}`,
      )
    }

    if (turnId) {
      const { error: activeAssistantUpdateError } = await supabase
        .from('chat_turns')
        .update({ active_assistant_message_id: finalAssistantMessageId } as never)
        .eq('id', turnId)
        .eq('chat_id', chatId)

      if (activeAssistantUpdateError) {
        throw new Error('Failed to update active assistant variant for turn')
      }
      activeAssistantPointerUpdated = true

      if (previousActiveAssistantId && previousActiveAssistantId !== finalAssistantMessageId) {
        const supersedeUpdate: MessageUpdate = {
          message_status: MESSAGE_STATUS_SUPERSEDED,
        }
        const { error: supersedeError } = await supabase
          .from('messages')
          .update(supersedeUpdate as never)
          .eq('id', previousActiveAssistantId)
          .eq('chat_id', chatId)

        if (supersedeError) {
          throw new Error('Failed to supersede previous assistant variant')
        }
        previousAssistantSuperseded = true
      }
    }
  } catch (error) {
    const originalMessage = error instanceof Error ? error.message : String(error)
    const rollbackFailures: string[] = []

    if (turnId && activeAssistantPointerUpdated) {
      const { error: restorePointerError } = await supabase
        .from('chat_turns')
        .update({ active_assistant_message_id: previousActiveAssistantId } as never)
        .eq('id', turnId)
        .eq('chat_id', chatId)

      if (restorePointerError) {
        rollbackFailures.push(
          `Failed to restore active assistant pointer: ${restorePointerError.message}`,
        )
      }
    }

    if (previousAssistantSuperseded && previousActiveAssistantId) {
      const { error: restoreAssistantError } = await supabase
        .from('messages')
        .update({ message_status: MESSAGE_STATUS_COMPLETED } as never)
        .eq('id', previousActiveAssistantId)
        .eq('chat_id', chatId)

      if (restoreAssistantError) {
        rollbackFailures.push(
          `Failed to restore previous assistant variant: ${restoreAssistantError.message}`,
        )
      }
    }

    if (insertedAssistantInPipeline) {
      const { error: deleteInsertedAssistantError } = await supabase
        .from('messages')
        .delete()
        .eq('id', finalAssistantMessageId)
        .eq('chat_id', chatId)

      if (deleteInsertedAssistantError) {
        rollbackFailures.push(
          `Failed to delete inserted assistant variant: ${deleteInsertedAssistantError.message}`,
        )
      }
    }

    if (rollbackFailures.length > 0) {
      throw new Error(
        `Assistant finalization rollback incomplete after "${originalMessage}": ${rollbackFailures.join('; ')}`,
      )
    }

    throw error
  }

  return {
    assistantMessageId: finalAssistantMessageId,
    messageInsertDuration: finalMessageInsertDuration,
  }
}
