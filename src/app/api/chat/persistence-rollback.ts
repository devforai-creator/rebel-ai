import { createClient } from '@/lib/supabase/server'

type RouteSupabaseClient = Awaited<ReturnType<typeof createClient>>

export async function rollbackPersistedUserMessage(
  supabase: RouteSupabaseClient,
  messageId: string,
  chatId: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.from('messages').delete().eq('id', messageId)
  if (error) {
    console.error('[Chat API] Failed to rollback persisted user message', {
      chatId,
      requestId,
      messageId,
      error: error.message,
    })
  }
}

export async function rollbackPersistedChatTurn(
  supabase: RouteSupabaseClient,
  turnId: string,
  chatId: string,
  requestId: string,
): Promise<void> {
  const { error } = await supabase.from('chat_turns').delete().eq('id', turnId)
  if (error) {
    console.error('[Chat API] Failed to rollback persisted chat turn', {
      chatId,
      requestId,
      turnId,
      error: error.message,
    })
  }
}
