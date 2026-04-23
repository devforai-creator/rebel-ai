import type { ChatSummaryInsert } from '@/types/database.types'
import type { ServerSupabaseClient } from './types'

type PersistableChatSummaryRow = Pick<
  ChatSummaryInsert,
  'chat_id' | 'user_id' | 'level' | 'start_seq' | 'end_seq' | 'summary' | 'token_count'
>
import { countProjectedConversationMessages } from '@/lib/chat/turns'

/**
 * Get total visible conversation message count for a chat.
 * This counts the active user/assistant transcript only.
 */
export async function getMessageCount(
  supabase: ServerSupabaseClient,
  chatId: string,
): Promise<number | null> {
  try {
    return await countProjectedConversationMessages({
      supabase,
      chatId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to count messages:', message)
    return null
  }
}

/**
 * Get the latest visible conversation ordinal for a chat.
 * The function name is kept for compatibility with older callers.
 */
export async function getLatestMessageSequence(
  supabase: ServerSupabaseClient,
  chatId: string,
): Promise<number | null> {
  try {
    const count = await countProjectedConversationMessages({
      supabase,
      chatId,
    })
    return count > 0 ? count : null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Failed to fetch latest message sequence:', message)
    return null
  }
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

async function updateExistingExactSummaryRange(
  supabase: ServerSupabaseClient,
  row: PersistableChatSummaryRow,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('chat_summaries')
    .update({
      summary: row.summary,
      token_count: row.token_count ?? null,
    })
    .eq('chat_id', row.chat_id)
    .eq('level', row.level)
    .eq('start_seq', row.start_seq)
    .eq('end_seq', row.end_seq)
    .select('id')
    .maybeSingle<{ id: string }>()

  if (error) {
    if (error.code === 'PGRST116') {
      return false
    }

    throw error
  }

  return Boolean(data)
}

export async function persistChatSummaryRow(
  supabase: ServerSupabaseClient,
  row: PersistableChatSummaryRow,
): Promise<void> {
  const summariesTable = supabase.from('chat_summaries')

  const result =
    'upsert' in summariesTable && typeof summariesTable.upsert === 'function'
      ? await summariesTable.upsert(row, {
          onConflict: 'chat_id,level,start_seq',
        })
      : await summariesTable.insert<ChatSummaryInsert>(row)

  const error = result.error
  if (!error) {
    return
  }

  if (
    (error.code === '23514' || error.code === '23505') &&
    (await updateExistingExactSummaryRange(supabase, row))
  ) {
    return
  }

  throw error
}
