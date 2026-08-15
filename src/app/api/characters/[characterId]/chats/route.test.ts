import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
const loadCharacterChatsMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/chat/character-chats', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat/character-chats')>(
    '@/lib/chat/character-chats',
  )
  return {
    ...actual,
    loadCharacterChats: loadCharacterChatsMock,
  }
})

function createSupabase(options: {
  user: { id: string } | null
  character?: { id: string; user_id: string | null } | null
  characterError?: { message: string } | null
}) {
  const characterBuilder = {
    select: vi.fn(() => characterBuilder),
    eq: vi.fn(() => characterBuilder),
    is: vi.fn(() => characterBuilder),
    single: vi.fn().mockResolvedValue({
      data: options.character ?? null,
      error: options.characterError ?? null,
    }),
  }

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: options.user },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table !== 'characters') throw new Error(`Unexpected table ${table}`)
      return characterBuilder
    }),
  }
}

function context(characterId = 'char-1') {
  return { params: Promise.resolve({ characterId }) }
}

describe('GET /api/characters/[characterId]/chats', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    loadCharacterChatsMock.mockReset()
  })

  it('returns 401 for signed-out users', async () => {
    createClientMock.mockResolvedValue(createSupabase({ user: null }))
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/characters/char-1/chats'),
      context(),
    )

    expect(response.status).toBe(401)
    expect(loadCharacterChatsMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the character is unavailable', async () => {
    createClientMock.mockResolvedValue(createSupabase({ user: { id: 'user-1' }, character: null }))
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/characters/missing/chats'),
      context('missing'),
    )

    expect(response.status).toBe(404)
  })

  it('returns 403 when an accessible character has a different owner', async () => {
    createClientMock.mockResolvedValue(
      createSupabase({
        user: { id: 'user-1' },
        character: { id: 'char-1', user_id: 'user-2' },
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/characters/char-1/chats'),
      context(),
    )

    expect(response.status).toBe(403)
  })

  it('returns the shared loader page with the opaque cursor', async () => {
    const supabase = createSupabase({
      user: { id: 'user-1' },
      character: { id: 'char-1', user_id: 'user-1' },
    })
    createClientMock.mockResolvedValue(supabase)
    loadCharacterChatsMock.mockResolvedValue({
      chats: [],
      hasMore: false,
      nextCursor: null,
    })
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/characters/char-1/chats?cursor=opaque'),
      context(),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      chats: [],
      hasMore: false,
      nextCursor: null,
    })
    expect(loadCharacterChatsMock).toHaveBeenCalledWith({
      supabase,
      characterId: 'char-1',
      cursor: 'opaque',
    })
  })

  it('returns 400 for malformed cursors', async () => {
    const { InvalidCharacterChatsCursorError } = await import('@/lib/chat/character-chats')
    createClientMock.mockResolvedValue(
      createSupabase({
        user: { id: 'user-1' },
        character: { id: 'char-1', user_id: 'user-1' },
      }),
    )
    loadCharacterChatsMock.mockRejectedValue(new InvalidCharacterChatsCursorError())
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/characters/char-1/chats?cursor=bad'),
      context(),
    )

    expect(response.status).toBe(400)
  })

  it('logs loader failures and returns a safe 500 response', async () => {
    createClientMock.mockResolvedValue(
      createSupabase({
        user: { id: 'user-1' },
        character: { id: 'char-1', user_id: 'user-1' },
      }),
    )
    loadCharacterChatsMock.mockRejectedValue(new Error('database detail'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/characters/char-1/chats'),
      context(),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to load chats' })
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Character chats] Failed to load chats',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})
