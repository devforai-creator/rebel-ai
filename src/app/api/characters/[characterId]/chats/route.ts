import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CHARACTER_CHAT_PAGE_SIZE } from '@/lib/chat/constants'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const { characterId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ensure the user can access this character (own character or starter)
  const { data: character, error: characterError } = await supabase
    .from('characters')
    .select('id, user_id')
    .eq('id', characterId)
    .is('archived_at', null)
    .single()

  if (characterError || !character) {
    return NextResponse.json({ error: 'Character not found' }, { status: 404 })
  }

  if (character.user_id && character.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const beforeParam = new URL(request.url).searchParams.get('before')

  let query = supabase
    .from('chats')
    .select('id, title, updated_at, created_at, messages(content, role)')
    .eq('user_id', user.id)
    .eq('character_id', characterId)
    .order('updated_at', { ascending: false })
    .order('sequence', { referencedTable: 'messages', ascending: false })
    .limit(CHARACTER_CHAT_PAGE_SIZE + 1)

  if (beforeParam) {
    query = query.lt('updated_at', beforeParam)
  }

  const { data: chatData, error: chatsError } = await query

  if (chatsError) {
    console.error('[Character chats] Failed to load chats', chatsError)
    return NextResponse.json({ error: 'Failed to load chats' }, { status: 500 })
  }

  const rawChats = chatData ?? []
  const hasMore = rawChats.length > CHARACTER_CHAT_PAGE_SIZE
  const trimmedChats = hasMore ? rawChats.slice(0, CHARACTER_CHAT_PAGE_SIZE) : rawChats

  // 마지막 메시지만 추출
  const chats = trimmedChats.map((chat) => {
    const messages = (chat as { messages?: Array<{ content: string; role: string }> }).messages
    return {
      id: chat.id,
      title: chat.title,
      updated_at: chat.updated_at,
      created_at: chat.created_at,
      lastMessage: messages?.[0] ?? null,
    }
  })

  const nextCursor = hasMore ? (chats[chats.length - 1]?.updated_at ?? null) : null

  return NextResponse.json({
    chats,
    hasMore,
    nextCursor,
  })
}
