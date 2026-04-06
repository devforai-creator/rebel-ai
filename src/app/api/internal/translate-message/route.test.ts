import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { TranslationResult } from '@/lib/chat/translation-service'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

type MessageRow = {
  id: string
  content: string
  content_en: string | null
  user_id?: string
}

let supabaseMock: ReturnType<typeof createSupabaseMock>
const translateMessageForUserMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => supabaseMock),
}))

vi.mock('@/lib/chat/translation-service', () => ({
  translateMessageForUser: (...args: unknown[]) => translateMessageForUserMock(...args),
}))

function createSupabaseMock(messages: MessageRow[], defaultUserId = 'user-1') {
  return {
    from(table: string) {
      if (table !== 'messages') {
        throw new Error(`Unexpected table: ${table}`)
      }

      const filters: Array<[string, unknown]> = []
      const tableApi = {
        select: () => tableApi,
        eq: (field: string, value: unknown) => {
          filters.push([field, value])
          return tableApi
        },
        single: async () => {
          const idFilter = filters.find(([f]) => f === 'id')
          const userFilter = filters.find(([f]) => f === 'user_id')
          const message = messages.find((m) => {
            const matchesId = !idFilter || m.id === idFilter[1]
            const messageUserId = m.user_id ?? defaultUserId
            const matchesUser = userFilter ? messageUserId === userFilter[1] : false
            return matchesId && matchesUser
          })
          return message
            ? { data: message, error: null }
            : { data: null, error: { code: 'PGRST116' } }
        },
      }
      return tableApi
    },
  }
}

function buildRequest(body: unknown, auth?: string) {
  return new NextRequest('http://localhost/api/internal/translate-message', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/translate-message', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    translateMessageForUserMock.mockReset()
    supabaseMock = createSupabaseMock([])
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Server misconfigured')
  })

  it('returns 401 when authorization header is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when secret does not match', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}, 'Bearer wrong-secret'))

    expect(response.status).toBe(401)
  })

  it('returns 400 when messageId is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({ userId: 'user-1' }, 'Bearer admin-secret'))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Missing messageId or userId')
  })

  it('returns 400 when userId is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({ messageId: 'msg-1' }, 'Bearer admin-secret'))

    expect(response.status).toBe(400)
  })

  it('returns 404 when message is not found', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([])
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(404)
    const body = await response.json()
    expect(body.error).toBe('Message not found')
  })

  it('skips translation when content_en already exists', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: 'Hello' }])
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.skipped).toBe(true)
    expect(translateMessageForUserMock).not.toHaveBeenCalled()
  })

  it('returns skipped when user has no API key configured', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: null }])
    translateMessageForUserMock.mockResolvedValueOnce({
      status: 'missing_api_key',
    } as TranslationResult)
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.skipped).toBe(true)
    expect(body.reason).toBe('no_api_key')
  })

  it('returns skipped when user profile is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: null }])
    translateMessageForUserMock.mockResolvedValueOnce({
      status: 'missing_profile',
    } as TranslationResult)
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.skipped).toBe(true)
    expect(body.reason).toBe('no_api_key')
  })

  it('returns 400 when API key is invalid', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: null }])
    translateMessageForUserMock.mockResolvedValueOnce({
      status: 'invalid_api_key',
      apiKeyId: 'key-123',
    } as TranslationResult)
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid configuration')
  })

  it('returns 500 when saving translation fails', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: null }])
    translateMessageForUserMock.mockResolvedValueOnce({
      status: 'save_error',
      error: 'Database error',
    } as TranslationResult)
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Failed to save translation')
  })

  it('returns 500 when vault error occurs', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: null }])
    translateMessageForUserMock.mockResolvedValueOnce({
      status: 'vault_error',
      error: 'Vault unavailable',
    } as TranslationResult)
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Translation failed')
  })

  it('returns 500 when translation error occurs', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: null }])
    translateMessageForUserMock.mockResolvedValueOnce({
      status: 'translation_error',
      error: 'API rate limit',
    } as TranslationResult)
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(500)
  })

  it('returns success with translated content', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: null }])
    translateMessageForUserMock.mockResolvedValueOnce({
      status: 'success',
      content: 'Hello',
    } as TranslationResult)
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.content_en).toBe('Hello')
  })

  it('passes correct parameters to translateMessageForUser', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([
      { id: 'msg-1', content: '번역할 내용입니다', content_en: null },
    ])
    translateMessageForUserMock.mockResolvedValueOnce({
      status: 'success',
      content: 'Content to translate',
    } as TranslationResult)
    const { POST } = await import('./route')

    await POST(buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'))

    expect(translateMessageForUserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        messageId: 'msg-1',
        messageContent: '번역할 내용입니다',
        trimOutput: true,
      }),
    )
  })

  it('returns 500 when unexpected error is thrown', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([{ id: 'msg-1', content: '안녕하세요', content_en: null }])
    translateMessageForUserMock.mockRejectedValueOnce(new Error('Unexpected error'))
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest({ messageId: 'msg-1', userId: 'user-1' }, 'Bearer admin-secret'),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Translation failed')
  })
})
