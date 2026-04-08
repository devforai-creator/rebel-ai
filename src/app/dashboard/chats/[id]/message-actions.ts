'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

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

  if (!message || !message.chats) {
    return { error: 'Message not found or unauthorized' }
  }

  const chat = message.chats as unknown as { user_id: string }
  if (chat.user_id !== user.id) {
    return { error: 'Unauthorized' }
  }

  // Update message content
  const { error } = await supabase
    .from('messages')
    .update({ content: newContent.trim() })
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
    .select('chat_id, chats(user_id)')
    .eq('id', messageId)
    .single()

  if (!message || !message.chats) {
    return { error: 'Message not found or unauthorized' }
  }

  const typedMessage = message as unknown as {
    id: string
    chat_id: string
    role: 'user' | 'assistant' | 'system'
    turn_id: string | null
    chats: { user_id: string }
  }

  const chat = typedMessage.chats
  if (chat.user_id !== user.id) {
    return { error: 'Unauthorized' }
  }

  let error: { message: string } | null = null

  if (typedMessage.turn_id && typedMessage.role === 'user') {
    const turnDeleteResult = await supabase
      .from('chat_turns')
      .delete()
      .eq('id', typedMessage.turn_id)
    error = turnDeleteResult.error
  } else if (typedMessage.turn_id && typedMessage.role === 'assistant') {
    const { data: turn } = await supabase
      .from('chat_turns')
      .select('active_assistant_message_id')
      .eq('id', typedMessage.turn_id)
      .single()

    if (turn?.active_assistant_message_id === messageId) {
      const { error: turnUpdateError } = await supabase
        .from('chat_turns')
        .update({ active_assistant_message_id: null })
        .eq('id', typedMessage.turn_id)

      if (turnUpdateError) {
        console.error('[deleteMessage] Failed to clear active assistant pointer', {
          messageId,
          turnId: typedMessage.turn_id,
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

  revalidatePath(`/dashboard/chats/${typedMessage.chat_id}`)
  return { success: true, chatId: typedMessage.chat_id }
}
