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
    .select('chat_id, chats(user_id)')
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

  const chat = message.chats as unknown as { user_id: string }
  if (chat.user_id !== user.id) {
    return { error: 'Unauthorized' }
  }

  // Delete message
  const { error } = await supabase.from('messages').delete().eq('id', messageId)

  if (error) {
    console.error('[deleteMessage] Failed to delete message', { messageId, error })
    return { error: 'Failed to delete message' }
  }

  revalidatePath(`/dashboard/chats/${message.chat_id}`)
  return { success: true, chatId: message.chat_id }
}
