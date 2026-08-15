import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
const loadRecentConversationCharactersMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
}))

vi.mock('@/lib/chat/recent-characters', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chat/recent-characters')>(
    '@/lib/chat/recent-characters',
  )

  return {
    ...actual,
    loadRecentConversationCharacters: loadRecentConversationCharactersMock,
  }
})

function createSupabase(user: { id: string } | null, authError: unknown = null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: authError,
      }),
    },
  }
}

describe('GET /api/chats/recent-characters', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    loadRecentConversationCharactersMock.mockReset()
  })

  it('returns 401 when unauthenticated', async () => {
    createClientMock.mockResolvedValue(createSupabase(null))
    const { GET } = await import('./route')

    const response = await GET(new Request('http://localhost/api/chats/recent-characters'))

    expect(response.status).toBe(401)
    expect(loadRecentConversationCharactersMock).not.toHaveBeenCalled()
  })

  it('returns a stable success shape for authenticated users', async () => {
    const supabase = createSupabase({ id: 'user-1' })
    createClientMock.mockResolvedValue(supabase)
    loadRecentConversationCharactersMock.mockResolvedValue({
      characters: [],
      hasMore: false,
      nextCursor: null,
    })
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/recent-characters?limit=20&cursor=opaque'),
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      characters: [],
      hasMore: false,
      nextCursor: null,
    })
    expect(loadRecentConversationCharactersMock).toHaveBeenCalledWith({
      supabase,
      cursor: 'opaque',
      pageSize: 20,
    })
  })

  it('returns 400 for malformed cursors', async () => {
    const { InvalidRecentCharactersCursorError } = await import('@/lib/chat/recent-characters')
    createClientMock.mockResolvedValue(createSupabase({ id: 'user-1' }))
    loadRecentConversationCharactersMock.mockRejectedValue(new InvalidRecentCharactersCursorError())
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/recent-characters?cursor=bad'),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid pagination parameters' })
  })

  it('returns 400 for non-integer page sizes', async () => {
    createClientMock.mockResolvedValue(createSupabase({ id: 'user-1' }))
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/chats/recent-characters?limit=1.5'),
    )

    expect(response.status).toBe(400)
    expect(loadRecentConversationCharactersMock).not.toHaveBeenCalled()
  })

  it('logs query failures and returns a safe 500 response', async () => {
    createClientMock.mockResolvedValue(createSupabase({ id: 'user-1' }))
    loadRecentConversationCharactersMock.mockRejectedValue(new Error('database detail'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { GET } = await import('./route')

    const response = await GET(new Request('http://localhost/api/chats/recent-characters'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to load recent characters' })
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Recent Characters API] Failed to load recent characters',
      expect.any(Error),
    )
    consoleSpy.mockRestore()
  })
})
