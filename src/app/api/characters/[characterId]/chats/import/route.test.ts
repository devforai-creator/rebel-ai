import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()

const { importChatForUserMock } = vi.hoisted(() => ({
  importChatForUserMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('@/lib/chat/import-service', () => ({
  importChatForUser: (...args: unknown[]) => importChatForUserMock(...args),
}))

function buildSupabase(user: { id: string } | null) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
  }
}

function buildContext(characterId: string) {
  return { params: Promise.resolve({ characterId }) }
}

function buildImportRequest(file?: File, title?: string) {
  const formData = new FormData()
  if (file) {
    formData.set('file', file)
  }
  if (typeof title === 'string') {
    formData.set('title', title)
  }

  return new Request('http://localhost/api/characters/char-1/chats/import', {
    method: 'POST',
    body: formData,
  })
}

describe('POST /api/characters/[characterId]/chats/import', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockReset()
    importChatForUserMock.mockReset()
  })

  it('returns 401 when user is not authenticated', async () => {
    createClientMock.mockResolvedValue(buildSupabase(null))
    const { POST } = await import('./route')

    const response = await POST(
      buildImportRequest(new File(['{}'], 'chat.json')),
      buildContext('char-1'),
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Unauthorized',
    })
  })

  it('returns 400 when no file is attached', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ id: 'user-1' }))
    const { POST } = await import('./route')

    const response = await POST(buildImportRequest(), buildContext('char-1'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Please select a file',
    })
  })

  it('passes uploaded JSON content to the import service', async () => {
    const supabase = buildSupabase({ id: 'user-1' })
    createClientMock.mockResolvedValue(supabase)
    importChatForUserMock.mockResolvedValue({
      success: true,
      chatId: 'chat-42',
      messageCount: 8,
    })
    const { POST } = await import('./route')

    const response = await POST(
      buildImportRequest(new File(['{"data":{"message":[]}}'], 'chat.json'), ' Imported '),
      buildContext('char-1'),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      success: true,
      chatId: 'chat-42',
      messageCount: 8,
    })
    expect(importChatForUserMock).toHaveBeenCalledWith({
      supabase,
      userId: 'user-1',
      characterId: 'char-1',
      jsonContent: '{"data":{"message":[]}}',
      chatTitle: 'Imported',
    })
  })

  it('returns import service validation failures as 400', async () => {
    createClientMock.mockResolvedValue(buildSupabase({ id: 'user-1' }))
    importChatForUserMock.mockResolvedValue({
      success: false,
      error: 'Invalid chat file format',
    })
    const { POST } = await import('./route')

    const response = await POST(
      buildImportRequest(new File(['bad'], 'bad.json')),
      buildContext('char-1'),
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Invalid chat file format',
    })
  })
})
