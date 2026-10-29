import 'server-only'

import type { ChatMemoryConfig } from '@/lib/chat/model-config'
import { countProjectedConversationMessages } from '@/lib/chat/turns'
import type { ServerSupabaseClient } from '@/lib/chat-summaries/types'
import type { ChatSummary } from '@/types/database.types'
import { resolvePrefixSummaryState } from './prefix-summary-state'

export type MemorySummaryRow = Pick<
  ChatSummary,
  'id' | 'level' | 'start_seq' | 'end_seq' | 'summary' | 'summary_status' | 'created_at'
>

export async function loadPrefixSummaryRows(
  supabase: ServerSupabaseClient,
  chatId: string,
): Promise<MemorySummaryRow[]> {
  const rows: MemorySummaryRow[] = []
  const pageSize = 1000

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('chat_summaries')
      .select('id, level, start_seq, end_seq, summary, summary_status, created_at')
      .eq('chat_id', chatId)
      .order('start_seq', { ascending: true })
      .order('level', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error('[chat-memory] Failed to load prefix summaries:', error.message)
      return []
    }

    rows.push(...(data ?? []))
    if (!data || data.length < pageSize) return rows
  }
}

/** One input contract for generation, drafts, memory UI, and its stats refresh. */
export async function loadMemoryState({
  supabase,
  chatId,
  memoryConfig,
  excludeAssistantForTurnId,
}: {
  supabase: ServerSupabaseClient
  chatId: string
  memoryConfig: Required<ChatMemoryConfig>
  excludeAssistantForTurnId?: string | null
}) {
  const [messageCount, summaries] = await Promise.all([
    countProjectedConversationMessages({ supabase, chatId, excludeAssistantForTurnId }),
    loadPrefixSummaryRows(supabase, chatId),
  ])

  return {
    messageCount,
    summaries,
    prefixSummaryState:
      memoryConfig.mode === 'prefix_live_blocks'
        ? resolvePrefixSummaryState(summaries, messageCount - memoryConfig.retainTailMessages)
        : undefined,
  }
}
