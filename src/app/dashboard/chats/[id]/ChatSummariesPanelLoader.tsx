import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { resolveChatMemoryConfig } from '@/lib/chat/model-config'
import { loadMemoryState } from '@/lib/chat-memory/load-memory-state'
import { loadLatestProjectedAssistantMessage } from '@/lib/chat/turns'
import ChatSummariesPanel from './ChatSummariesPanel'
import { parseSummaryWarningInfo } from './summary-warning'

interface Props {
  chatId: string
}

export default async function ChatSummariesPanelLoader({ chatId }: Props) {
  const supabase = await createClient()
  const { data: chat } = await supabase
    .from('chats')
    .select('model_config')
    .eq('id', chatId)
    .single<{ model_config: unknown }>()
  const memoryConfig = resolveChatMemoryConfig(chat?.model_config ?? null)

  const [memoryState, { data: facts }, latestAssistant] = await Promise.all([
    loadMemoryState({ supabase, chatId, memoryConfig }),
    supabase
      .from('chat_facts')
      .select('id, start_seq, end_seq, facts, created_at')
      .eq('chat_id', chatId)
      .order('start_seq', { ascending: true }),
    loadLatestProjectedAssistantMessage({
      supabase,
      chatId,
    }),
  ])

  const { messageCount: totalMessages, summaries } = memoryState
  const summaryWarning = parseSummaryWarningInfo(latestAssistant?.debug_info ?? null)

  return (
    <ChatSummariesPanel
      chatId={chatId}
      summaries={summaries || []}
      facts={facts || []}
      totalMessages={totalMessages}
      latestSequence={totalMessages}
      memoryConfig={memoryConfig}
      summaryWarning={summaryWarning}
    />
  )
}
