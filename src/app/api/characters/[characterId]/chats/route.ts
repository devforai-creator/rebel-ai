import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { InvalidCharacterChatsCursorError, loadCharacterChats } from '@/lib/chat/character-chats'

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

  try {
    const cursor = new URL(request.url).searchParams.get('cursor')
    const page = await loadCharacterChats({ supabase, characterId, cursor })
    return NextResponse.json(page)
  } catch (error) {
    if (error instanceof InvalidCharacterChatsCursorError) {
      return NextResponse.json({ error: 'Invalid pagination cursor' }, { status: 400 })
    }

    console.error('[Character chats] Failed to load chats', error)
    return NextResponse.json({ error: 'Failed to load chats' }, { status: 500 })
  }
}
