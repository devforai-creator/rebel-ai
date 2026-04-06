import { createClient } from '@/lib/supabase/server'
import ChatSummariesPanel from './ChatSummariesPanel'

interface Props {
  chatId: string
}

export default async function ChatSummariesPanelLoader({ chatId }: Props) {
  const supabase = await createClient()

  const [
    { data: summaries },
    { data: facts },
    { count: totalMessagesCount },
    { data: latestSequenceRow },
  ] = await Promise.all([
    supabase
      .from('chat_summaries')
      .select('id, level, start_seq, end_seq, summary, created_at')
      .eq('chat_id', chatId)
      .order('level', { ascending: false })
      .order('start_seq', { ascending: true }),
    supabase
      .from('chat_facts')
      .select('id, start_seq, end_seq, facts, created_at')
      .eq('chat_id', chatId)
      .order('start_seq', { ascending: true }),
    supabase.from('messages').select('id', { head: true, count: 'exact' }).eq('chat_id', chatId),
    supabase
      .from('messages')
      .select('sequence')
      .eq('chat_id', chatId)
      .order('sequence', { ascending: false })
      .limit(1)
      .maybeSingle<{ sequence: number }>(),
  ])

  const totalMessages = typeof totalMessagesCount === 'number' ? totalMessagesCount : 0
  const latestSequence =
    typeof latestSequenceRow?.sequence === 'number' ? latestSequenceRow.sequence : totalMessages

  return (
    <ChatSummariesPanel
      chatId={chatId}
      summaries={summaries || []}
      facts={facts || []}
      totalMessages={totalMessages}
      latestSequence={latestSequence}
    />
  )
}
