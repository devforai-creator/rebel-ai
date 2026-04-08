import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CHAT_MESSAGE_PAGE_SIZE } from '@/lib/chat/constants'
import { MESSAGE_STATUS_GENERATING, MESSAGE_STATUS_SUPERSEDED } from '@/lib/chat/message-status'

export async function GET(req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params
  const searchParams = new URL(req.url).searchParams
  const beforeParam = searchParams.get('before')
  const beforeSequence = beforeParam ? Number(beforeParam) : null

  if (!beforeSequence || Number.isNaN(beforeSequence)) {
    return NextResponse.json({ error: 'before parameter is required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: chat } = await supabase
    .from('chats')
    .select('id')
    .eq('id', chatId)
    .eq('user_id', user.id)
    .single()

  if (!chat) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Select only needed columns (exclude debug_info for performance)
  const { data: historyData, error: historyError } = await supabase
    .from('messages')
    .select(
      'id, chat_id, role, content, sequence, created_at, model_used, prompt_tokens, completion_tokens, turn_id, variant_index, supersedes_message_id, message_status',
    )
    .eq('chat_id', chatId)
    .neq('message_status', MESSAGE_STATUS_SUPERSEDED)
    .neq('message_status', MESSAGE_STATUS_GENERATING)
    .lt('sequence', beforeSequence)
    .order('sequence', { ascending: false })
    .limit(CHAT_MESSAGE_PAGE_SIZE)

  if (historyError) {
    console.error('[Chat history] failed to load messages', historyError)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }

  const historyMessages = (historyData || []).sort((a, b) => a.sequence - b.sequence)

  if (historyMessages.length === 0) {
    return NextResponse.json({ messages: [], hasMore: false, nextCursor: null })
  }

  const nextCursor = historyMessages[0]?.sequence ?? null

  // Determine hasMore based on fetched count instead of extra COUNT query
  // If we got exactly PAGE_SIZE messages, there might be more
  const hasMore = historyMessages.length === CHAT_MESSAGE_PAGE_SIZE

  return NextResponse.json({
    messages: historyMessages,
    hasMore,
    nextCursor,
  })
}
