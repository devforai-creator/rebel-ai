import { describe, expect, it, vi } from 'vitest'

import {
  CharacterChatsQueryError,
  InvalidCharacterChatsCursorError,
  loadCharacterChats,
} from './character-chats'

function createRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '10000000-0000-0000-0000-000000000001',
    title: 'First chat',
    created_at: '2026-08-15T09:00:00+00:00',
    last_message_at: '2026-08-15T10:00:00+00:00',
    recency_at: '2026-08-15T10:00:00+00:00',
    is_bookmarked: false,
    preview_role: 'assistant',
    preview_content: ' Hello\nthere ',
    ...overrides,
  }
}

describe('loadCharacterChats', () => {
  it('maps a page and uses both recency and chat ID in its opaque cursor', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [createRow(), createRow({ id: '10000000-0000-0000-0000-000000000000' })],
      error: null,
    })

    const firstPage = await loadCharacterChats({
      supabase: { rpc } as never,
      characterId: '20000000-0000-0000-0000-000000000001',
      pageSize: 1,
    })

    expect(firstPage).toEqual({
      chats: [
        {
          id: '10000000-0000-0000-0000-000000000001',
          title: 'First chat',
          created_at: '2026-08-15T09:00:00+00:00',
          last_message_at: '2026-08-15T10:00:00+00:00',
          recency_at: '2026-08-15T10:00:00+00:00',
          is_bookmarked: false,
          lastMessage: { role: 'assistant', content: 'Hello there' },
        },
      ],
      hasMore: true,
      nextCursor: expect.any(String),
    })

    const nextRpc = vi.fn().mockResolvedValue({ data: [], error: null })
    await loadCharacterChats({
      supabase: { rpc: nextRpc } as never,
      characterId: '20000000-0000-0000-0000-000000000001',
      cursor: firstPage.nextCursor,
      pageSize: 1,
    })

    expect(nextRpc).toHaveBeenCalledWith('list_character_chats_with_bookmarks', {
      p_character_id: '20000000-0000-0000-0000-000000000001',
      p_page_size: 1,
      p_cursor_recency_at: '2026-08-15T10:00:00+00:00',
      p_cursor_chat_id: '10000000-0000-0000-0000-000000000001',
      p_cursor_is_bookmarked: false,
    })
  })

  it('keeps empty chats and maps created_at as their explicit recency fallback', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        createRow({
          last_message_at: null,
          recency_at: '2026-08-15T09:00:00+00:00',
          is_bookmarked: false,
          preview_role: null,
          preview_content: null,
        }),
      ],
      error: null,
    })

    const page = await loadCharacterChats({
      supabase: { rpc } as never,
      characterId: '20000000-0000-0000-0000-000000000001',
    })

    expect(page.chats[0]).toMatchObject({
      last_message_at: null,
      recency_at: '2026-08-15T09:00:00+00:00',
      is_bookmarked: false,
      lastMessage: null,
    })
  })

  it('includes bookmark state in the cursor when crossing into ordinary rooms', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: [createRow({ is_bookmarked: true }), createRow()], error: null })
    const page = await loadCharacterChats({
      supabase: { rpc } as never,
      characterId: 'char-1',
      pageSize: 1,
    })
    expect(page.chats[0].is_bookmarked).toBe(true)
    rpc.mockResolvedValue({ data: [], error: null })
    await loadCharacterChats({
      supabase: { rpc } as never,
      characterId: 'char-1',
      cursor: page.nextCursor,
    })
    expect(rpc).toHaveBeenLastCalledWith(
      'list_character_chats_with_bookmarks',
      expect.objectContaining({ p_cursor_is_bookmarked: true }),
    )
  })

  it('accepts a preceding deployment cursor and rejects incomplete bookmark cursors', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const payload = {
      v: 1,
      recencyAt: '2026-08-15T10:00:00+00:00',
      chatId: '10000000-0000-0000-0000-000000000001',
    }
    await loadCharacterChats({
      supabase: { rpc } as never,
      characterId: 'char-1',
      cursor: Buffer.from(JSON.stringify(payload)).toString('base64url'),
    })
    expect(rpc).toHaveBeenLastCalledWith(
      'list_character_chats_with_bookmarks',
      expect.objectContaining({ p_cursor_is_bookmarked: false }),
    )
    await expect(
      loadCharacterChats({
        supabase: { rpc } as never,
        characterId: 'char-1',
        cursor: Buffer.from(JSON.stringify({ ...payload, v: 2 })).toString('base64url'),
      }),
    ).rejects.toBeInstanceOf(InvalidCharacterChatsCursorError)
  })

  it('rejects malformed cursors before calling the RPC', async () => {
    const rpc = vi.fn()

    await expect(
      loadCharacterChats({
        supabase: { rpc } as never,
        characterId: '20000000-0000-0000-0000-000000000001',
        cursor: 'not-a-cursor',
      }),
    ).rejects.toBeInstanceOf(InvalidCharacterChatsCursorError)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('maps RPC details to a narrow query error', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '57014', message: 'database detail' },
    })

    await expect(
      loadCharacterChats({
        supabase: { rpc } as never,
        characterId: '20000000-0000-0000-0000-000000000001',
      }),
    ).rejects.toMatchObject({
      name: CharacterChatsQueryError.name,
      message: 'Failed to load character chats',
      code: '57014',
    })
  })
})
