import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CHAT_MESSAGE_PAGE_SIZE } from '@/lib/chat/constants'
import { loadProjectedChatWindow } from '@/lib/chat/turns'

export async function GET(req: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params
  const searchParams = new URL(req.url).searchParams
  const beforeParam = searchParams.get('before')
  const beforeTurnIndex = beforeParam ? Number(beforeParam) : null

  if (!beforeTurnIndex || Number.isNaN(beforeTurnIndex)) {
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

  try {
    const historyWindow = await loadProjectedChatWindow({
      supabase,
      chatId,
      beforeTurnIndex,
      limitTurns: CHAT_MESSAGE_PAGE_SIZE,
    })

    return NextResponse.json({
      messages: historyWindow.messages,
      hasMore: historyWindow.hasMore,
      nextCursor: historyWindow.nextCursor,
    })
  } catch (error) {
    console.error('[Chat history] failed to load messages', error)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }
}
