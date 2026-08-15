import {
  InvalidRecentCharactersCursorError,
  InvalidRecentCharactersPageSizeError,
  loadRecentConversationCharacters,
  parseRecentCharactersPageSizeParam,
} from '@/lib/chat/recent-characters'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const searchParams = new URL(request.url).searchParams
    const page = await loadRecentConversationCharacters({
      supabase,
      cursor: searchParams.get('cursor'),
      pageSize: parseRecentCharactersPageSizeParam(searchParams.get('limit')),
    })

    return Response.json(page)
  } catch (error) {
    if (
      error instanceof InvalidRecentCharactersCursorError ||
      error instanceof InvalidRecentCharactersPageSizeError
    ) {
      return Response.json({ error: 'Invalid pagination parameters' }, { status: 400 })
    }

    console.error('[Recent Characters API] Failed to load recent characters', error)
    return Response.json({ error: 'Failed to load recent characters' }, { status: 500 })
  }
}
