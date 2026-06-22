import { describe, expect, it, vi } from 'vitest'
import {
  fetchCharacterChatExport,
  fetchCharacterChatsPage,
  getExportFilename,
  importCharacterChat,
} from './character-chats-client'

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

describe('character-chats-client', () => {
  it('normalizes paginated chat responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        chats: [
          {
            id: 'chat-2',
            title: 'Imported',
            updated_at: '2026-01-01',
            created_at: '2026-01-01',
            lastMessage: null,
          },
        ],
        hasMore: true,
        nextCursor: 'cursor-2',
      }),
    )

    await expect(fetchCharacterChatsPage('char-1', 'cursor-1', fetchMock)).resolves.toEqual({
      chats: [
        {
          id: 'chat-2',
          title: 'Imported',
          updated_at: '2026-01-01',
          created_at: '2026-01-01',
          lastMessage: null,
        },
      ],
      hasMore: true,
      nextCursor: 'cursor-2',
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/characters/char-1/chats?before=cursor-1')
  })

  it('throws the API error when page loading fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createJsonResponse({ error: 'No access' }, { status: 403 }))

    await expect(fetchCharacterChatsPage('char-1', 'cursor-1', fetchMock)).rejects.toThrow(
      'No access',
    )
  })

  it('returns export blob metadata from the route response', async () => {
    const blob = new Blob(['{}'], { type: 'application/json' })
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(blob, {
        status: 200,
        headers: {
          'Content-Disposition': 'attachment; filename="guide%20chat.json"',
        },
      }),
    )

    const result = await fetchCharacterChatExport('chat-1', fetchMock)

    expect(result.filename).toBe('guide chat.json')
    expect(await result.blob.text()).toBe('{}')
  })

  it('uploads chat imports through the API route as FormData', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        success: true,
        chatId: 'chat-42',
        messageCount: 12,
      }),
    )
    const file = new File(['{"data":{"message":[]}}'], 'guide_chat.json', {
      type: 'application/json',
    })

    await expect(importCharacterChat('char-1', file, ' Imported ', fetchMock)).resolves.toEqual({
      success: true,
      chatId: 'chat-42',
      messageCount: 12,
      error: undefined,
      warnings: undefined,
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/characters/char-1/chats/import',
      expect.objectContaining({
        method: 'POST',
        body: expect.any(FormData),
      }),
    )

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('file')).toBe(file)
    expect(body.get('title')).toBe('Imported')
  })

  it('returns normalized import failures from the API route', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        createJsonResponse({ success: false, error: 'Invalid export' }, { status: 400 }),
      )

    await expect(
      importCharacterChat('char-1', new File(['bad'], 'bad.json'), undefined, fetchMock),
    ).resolves.toEqual({
      success: false,
      error: 'Invalid export',
    })
  })

  it('falls back to the default export filename when the header is missing', () => {
    expect(getExportFilename(null)).toBe('chat_export.json')
    expect(getExportFilename('attachment')).toBe('chat_export.json')
  })
})
