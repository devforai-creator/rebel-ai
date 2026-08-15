import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  InvalidRecentCharactersCursorError,
  InvalidRecentCharactersPageSizeError,
  loadRecentConversationCharacters,
  parseRecentCharactersPageSizeParam,
  RecentCharactersQueryError,
} from './recent-characters'

const resolveAvatarUrlMapMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/assets/character-avatar', () => ({
  resolveCharacterAvatarUrlMap: resolveAvatarUrlMapMock,
}))

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    character_id: '10000000-0000-0000-0000-000000000001',
    character_name: 'Guide',
    avatar_url: 'https://legacy.test/guide.png',
    last_message_at: '2026-08-15T00:00:00+00:00',
    latest_chat_id: '20000000-0000-0000-0000-000000000001',
    latest_chat_title: 'Latest chat',
    preview_role: 'assistant',
    preview_content: 'Welcome back',
    ...overrides,
  }
}

function encodeTestCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

describe('recent conversation character loader', () => {
  beforeEach(() => {
    resolveAvatarUrlMapMock.mockReset()
    resolveAvatarUrlMapMock.mockResolvedValue({})
  })

  it('maps one page, batches avatar resolution, and creates an opaque next cursor', async () => {
    const rows = [
      createRow(),
      createRow({
        character_id: '10000000-0000-0000-0000-000000000002',
        character_name: 'Lookahead',
      }),
    ]
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
    resolveAvatarUrlMapMock.mockResolvedValue({
      '10000000-0000-0000-0000-000000000001': 'https://signed.test/guide.png',
    })

    const page = await loadRecentConversationCharacters({
      supabase: { rpc } as never,
      pageSize: 1,
      avatarSupabase: {} as never,
    })

    expect(rpc).toHaveBeenCalledWith('list_recent_conversation_characters', { p_page_size: 1 })
    expect(resolveAvatarUrlMapMock).toHaveBeenCalledOnce()
    expect(resolveAvatarUrlMapMock.mock.calls[0]?.[1]).toEqual([
      {
        id: '10000000-0000-0000-0000-000000000001',
        avatar_url: 'https://legacy.test/guide.png',
      },
    ])
    expect(page).toEqual({
      characters: [
        {
          characterId: '10000000-0000-0000-0000-000000000001',
          characterName: 'Guide',
          avatarUrl: 'https://signed.test/guide.png',
          lastMessageAt: '2026-08-15T00:00:00+00:00',
          latestChatId: '20000000-0000-0000-0000-000000000001',
          latestChatTitle: 'Latest chat',
          preview: { role: 'assistant', content: 'Welcome back' },
        },
      ],
      hasMore: true,
      nextCursor: expect.any(String),
    })

    const nextRpc = vi.fn().mockResolvedValue({ data: [], error: null })
    await loadRecentConversationCharacters({
      supabase: { rpc: nextRpc } as never,
      cursor: page.nextCursor,
      pageSize: 1,
      avatarSupabase: {} as never,
    })

    expect(nextRpc).toHaveBeenCalledWith('list_recent_conversation_characters', {
      p_page_size: 1,
      p_cursor_last_message_at: '2026-08-15T00:00:00+00:00',
      p_cursor_character_id: '10000000-0000-0000-0000-000000000001',
    })
    expect(resolveAvatarUrlMapMock).toHaveBeenCalledOnce()
  })

  it('preserves nullable title and preview fields', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        createRow({
          avatar_url: null,
          latest_chat_title: null,
          preview_role: null,
          preview_content: null,
        }),
      ],
      error: null,
    })

    const page = await loadRecentConversationCharacters({
      supabase: { rpc } as never,
      avatarSupabase: {} as never,
    })

    expect(page.characters[0]).toMatchObject({
      avatarUrl: null,
      latestChatTitle: null,
      preview: null,
    })
    expect(page.hasMore).toBe(false)
    expect(page.nextCursor).toBeNull()
  })

  it.each([
    '',
    '***',
    encodeTestCursor({ v: 2 }),
    encodeTestCursor({
      v: 1,
      lastMessageAt: 'not-a-date',
      characterId: '10000000-0000-0000-0000-000000000001',
    }),
    encodeTestCursor({
      v: 1,
      lastMessageAt: '2026-08-15T00:00:00Z',
      characterId: 'not-a-uuid',
    }),
  ])('rejects malformed cursor %s before calling the RPC', async (cursor) => {
    const rpc = vi.fn()

    await expect(
      loadRecentConversationCharacters({
        supabase: { rpc } as never,
        cursor,
        avatarSupabase: {} as never,
      }),
    ).rejects.toBeInstanceOf(InvalidRecentCharactersCursorError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps RPC failures to a narrow query error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'database detail' },
    })

    await expect(
      loadRecentConversationCharacters({
        supabase: { rpc } as never,
        avatarSupabase: {} as never,
      }),
    ).rejects.toMatchObject({
      name: RecentCharactersQueryError.name,
      message: 'Failed to load recent conversation characters',
      code: '57014',
    })
  })
})

describe('parseRecentCharactersPageSizeParam', () => {
  it.each([
    [null, 15],
    ['0', 1],
    ['1', 1],
    ['25', 25],
    ['50', 50],
    ['100', 50],
    ['-5', 1],
  ])('normalizes %s to %i', (value, expected) => {
    expect(parseRecentCharactersPageSizeParam(value)).toBe(expected)
  })

  it.each(['', '1.5', 'many', '9007199254740992'])('rejects invalid page size %s', (value) => {
    expect(() => parseRecentCharactersPageSizeParam(value)).toThrow(
      InvalidRecentCharactersPageSizeError,
    )
  })
})
