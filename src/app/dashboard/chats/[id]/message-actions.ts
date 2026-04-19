'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

type ChatOwnerRelation = {
  user_id: string
}

type OwnedMessageRow = {
  id: string
  chat_id: string
  role: 'user' | 'assistant' | 'system'
  turn_id: string | null
  chats: ChatOwnerRelation | null
}

function isChatOwnerRelation(value: unknown): value is ChatOwnerRelation {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { user_id?: unknown }).user_id === 'string'
  )
}

function isOwnedMessageRow(value: unknown): value is OwnedMessageRow {
  if (!value || typeof value !== 'object') {
    return false
  }

  const row = value as Record<string, unknown>

  return (
    typeof row.id === 'string' &&
    typeof row.chat_id === 'string' &&
    (row.role === 'user' || row.role === 'assistant' || row.role === 'system') &&
    (typeof row.turn_id === 'string' || row.turn_id === null) &&
    (row.chats === null || isChatOwnerRelation(row.chats))
  )
}

function buildEditedMessageUpdate(content: string) {
  return {
    content,
    // Invalidate derived bilingual cache when the canonical message content changes.
    content_en: null,
  }
}

/**
 * Edit a message's content
 */
export async function editMessage(messageId: string, newContent: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Unauthorized' }
  }

  // Verify message ownership (via chat ownership)
  const { data: message } = await supabase
    .from('messages')
    .select('id, chat_id, role, turn_id, chats(user_id)')
    .eq('id', messageId)
    .single()

  if (!isOwnedMessageRow(message) || !message.chats) {
    return { error: 'Message not found or unauthorized' }
  }

  if (message.chats.user_id !== user.id) {
    return { error: 'Unauthorized' }
  }

  // Update message content
  const { error } = await supabase
    .from('messages')
    .update(buildEditedMessageUpdate(newContent.trim()))
    .eq('id', messageId)

  if (error) {
    console.error('[editMessage] Failed to update message', { messageId, error })
    return { error: 'Failed to update message' }
  }

  revalidatePath(`/dashboard/chats/${message.chat_id}`)
  return { success: true }
}

/**
 * Delete a message
 */
export async function deleteMessage(messageId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { error: 'Unauthorized' }
  }

  // Verify message ownership (via chat ownership)
  const { data: message } = await supabase
    .from('messages')
    .select('id, chat_id, role, turn_id, chats(user_id)')
    .eq('id', messageId)
    .single()

  if (!isOwnedMessageRow(message) || !message.chats) {
    return { error: 'Message not found or unauthorized' }
  }

  if (message.chats.user_id !== user.id) {
    return { error: 'Unauthorized' }
  }

  let error: { message: string } | null = null

  if (message.turn_id && message.role === 'user') {
    const turnDeleteResult = await supabase.from('chat_turns').delete().eq('id', message.turn_id)
    error = turnDeleteResult.error
  } else if (message.turn_id && message.role === 'assistant') {
    const { data: turn } = await supabase
      .from('chat_turns')
      .select('active_assistant_message_id')
      .eq('id', message.turn_id)
      .single()

    if (turn?.active_assistant_message_id === messageId) {
      const { error: turnUpdateError } = await supabase
        .from('chat_turns')
        .update({ active_assistant_message_id: null })
        .eq('id', message.turn_id)

      if (turnUpdateError) {
        console.error('[deleteMessage] Failed to clear active assistant pointer', {
          messageId,
          turnId: message.turn_id,
          error: turnUpdateError,
        })
        return { error: 'Failed to delete message' }
      }
    }

    const deleteResult = await supabase.from('messages').delete().eq('id', messageId)
    error = deleteResult.error
  } else {
    const deleteResult = await supabase.from('messages').delete().eq('id', messageId)
    error = deleteResult.error
  }

  if (error) {
    console.error('[deleteMessage] Failed to delete message', { messageId, error })
    return { error: 'Failed to delete message' }
  }

  revalidatePath(`/dashboard/chats/${message.chat_id}`)
  return { success: true, chatId: message.chat_id }
}
