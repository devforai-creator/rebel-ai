import type { ServerSupabaseClient } from './types'
import { MESSAGE_STATUS_GENERATING, MESSAGE_STATUS_SUPERSEDED } from '@/lib/chat/message-status'

/**
 * Get total message count for a chat
 */
export async function getMessageCount(
  supabase: ServerSupabaseClient,
  chatId: string,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('chat_id', chatId)
    .neq('message_status', MESSAGE_STATUS_SUPERSEDED)
    .neq('message_status', MESSAGE_STATUS_GENERATING)

  if (error) {
    console.error('Failed to count messages:', error.message)
    return null
  }

  return count ?? 0
}

/**
 * Get the latest message sequence number for a chat
 */
export async function getLatestMessageSequence(
  supabase: ServerSupabaseClient,
  chatId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('messages')
    .select('sequence')
    .eq('chat_id', chatId)
    .neq('message_status', MESSAGE_STATUS_SUPERSEDED)
    .neq('message_status', MESSAGE_STATUS_GENERATING)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle<{ sequence: number }>()

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Failed to fetch latest message sequence:', error.message)
    }
    return null
  }

  return data?.sequence ?? null
}

/**
 * Get the last summary end sequence for a given level
 */
export async function getLastSummaryEnd(
  supabase: ServerSupabaseClient,
  chatId: string,
  level: number,
): Promise<number | null> {
  const { data, error } = await supabase
    .from('chat_summaries')
    .select('end_seq')
    .eq('chat_id', chatId)
    .eq('level', level)
    .order('end_seq', { ascending: false })
    .limit(1)
    .maybeSingle<{ end_seq: number }>()

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('Failed to fetch last summary end:', error.message)
    }
    return null
  }

  return data ? data.end_seq : null
}
