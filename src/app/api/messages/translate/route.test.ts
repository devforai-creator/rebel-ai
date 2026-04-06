import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const hoistedMocks = vi.hoisted(() => {
  const createClientMock = vi.fn()
  const createAdminClientMock = vi.fn()
  const generateTextMock = vi.fn()
  const checkUserRateLimitMock = vi.fn()
  return { createClientMock, createAdminClientMock, generateTextMock, checkUserRateLimitMock }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => hoistedMocks.createClientMock(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => hoistedMocks.createAdminClientMock(),
}))

vi.mock('@/lib/chat/rate-limiter', () => ({
  checkUserRateLimit: hoistedMocks.checkUserRateLimitMock,
}))

vi.mock('ai', () => ({
  generateText: hoistedMocks.generateTextMock,
}))

// Mock provider SDKs
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => vi.fn(() => ({ modelId: 'gemini' }))),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({ chat: vi.fn(() => ({ modelId: 'openrouter' })) })),
}))

vi.mock('@/lib/openai/service-tier', () => ({
  createOpenAIWithServiceTier: vi.fn(() => vi.fn(() => ({ modelId: 'gpt-4o-mini' }))),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => vi.fn(() => ({ modelId: 'claude' }))),
}))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(() => vi.fn(() => ({ modelId: 'deepseek' }))),
}))

import { POST } from './route'

interface MockConfig {
  user?: { id: string } | null
  message?: {
    id: string
    chat_id: string
    role: string
    content: string
    content_en: string | null
    user_id: string
  } | null
  profile?: { translation_api_key_id: string | null } | null
  apiKey?: {
    id: string
    user_id: string
    provider: string
    model_preference: string
    vault_secret_name: string
    is_active: boolean
    service_tier?: string | null
  } | null
  decryptedSecret?: string
}

function createMockSupabase(config: MockConfig) {
  const { user, message, profile, apiKey } = config

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: user ? null : { message: 'Not authenticated' },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'messages') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: message,
            error: message ? null : { code: 'PGRST116', message: 'Not found' },
          }),
          update: vi.fn().mockReturnThis(),
        }
      }
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: profile,
            error: profile ? null : { code: 'PGRST116', message: 'Not found' },
          }),
        }
      }
      if (table === 'api_keys') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: apiKey,
            error: apiKey ? null : { code: 'PGRST116', message: 'Not found' },
          }),
          update: vi.fn().mockReturnThis(),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        update: vi.fn().mockReturnThis(),
      }
    }),
  }
}

function createMockAdminSupabase(decryptedSecret: string = 'sk-test-key') {
  return {
    rpc: vi.fn().mockResolvedValue({
      data: decryptedSecret,
      error: null,
    }),
  }
}

function createRequest(body: Record<string, unknown>) {
  return new Request('http://localhost:3000/api/messages/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/messages/translate', () => {
  beforeEach(() => {
    restoreEnv()
    process.env.CHAT_ADMIN_SECRET = 'test-chat-admin-secret'
    vi.clearAllMocks()
    // Default: rate limiting allowed
    hoistedMocks.checkUserRateLimitMock.mockResolvedValue({ allowed: true, retryAfter: null })
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 429 when rate limited', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createMockSupabase({ user: { id: 'user-1' } }))
    hoistedMocks.checkUserRateLimitMock.mockResolvedValue({ allowed: false, retryAfter: 30 })

    const response = await POST(createRequest({ messageId: 'msg-1' }))

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(await response.text()).toBe('Too many requests')
  })

  it('returns 401 for unauthenticated users', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createMockSupabase({ user: null }))

    const response = await POST(createRequest({ messageId: 'msg-1' }))

    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Unauthorized')
  })

  it('returns 400 when messageId is missing', async () => {
    hoistedMocks.createClientMock.mockReturnValue(createMockSupabase({ user: { id: 'user-1' } }))

    const response = await POST(createRequest({}))

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Missing messageId')
  })

  it('returns 404 when message not found', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createMockSupabase({
        user: { id: 'user-1' },
        message: null,
      }),
    )

    const response = await POST(createRequest({ messageId: 'nonexistent' }))

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Message not found')
  })

  it('returns 403 when message belongs to different user', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createMockSupabase({
        user: { id: 'user-1' },
        message: {
          id: 'msg-1',
          chat_id: 'chat-1',
          role: 'user',
          content: '안녕하세요',
          content_en: null,
          user_id: 'user-2', // Different user
        },
      }),
    )

    const response = await POST(createRequest({ messageId: 'msg-1' }))

    expect(response.status).toBe(403)
    expect(await response.text()).toBe('Forbidden')
  })

  it('returns 400 when translation not enabled', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createMockSupabase({
        user: { id: 'user-1' },
        message: {
          id: 'msg-1',
          chat_id: 'chat-1',
          role: 'user',
          content: '안녕하세요',
          content_en: null,
          user_id: 'user-1',
        },
        profile: { translation_api_key_id: null },
      }),
    )

    const response = await POST(createRequest({ messageId: 'msg-1' }))

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Translation not configured')
  })

  it('returns 400 when API key not found', async () => {
    hoistedMocks.createClientMock.mockReturnValue(
      createMockSupabase({
        user: { id: 'user-1' },
        message: {
          id: 'msg-1',
          chat_id: 'chat-1',
          role: 'user',
          content: '안녕하세요',
          content_en: null,
          user_id: 'user-1',
        },
        profile: { translation_api_key_id: 'key-1' },
        apiKey: null,
      }),
    )

    const response = await POST(createRequest({ messageId: 'msg-1' }))

    expect(response.status).toBe(400)
    expect(await response.text()).toContain('Invalid API key configuration')
  })

  it('successfully translates message and updates DB', async () => {
    const mockSupabase = createMockSupabase({
      user: { id: 'user-1' },
      message: {
        id: 'msg-1',
        chat_id: 'chat-1',
        role: 'user',
        content: '안녕하세요',
        content_en: null,
        user_id: 'user-1',
      },
      profile: { translation_api_key_id: 'key-1' },
      apiKey: {
        id: 'key-1',
        user_id: 'user-1',
        provider: 'openai',
        model_preference: 'gpt-4o-mini',
        vault_secret_name: 'vault-key',
        is_active: true,
        service_tier: null,
      },
    })

    hoistedMocks.createClientMock.mockReturnValue(mockSupabase)
    hoistedMocks.createAdminClientMock.mockReturnValue(createMockAdminSupabase('sk-test'))
    hoistedMocks.generateTextMock.mockResolvedValue({ text: 'Hello' })

    const response = await POST(createRequest({ messageId: 'msg-1' }))

    expect(response.status).toBe(200)
    const json = await response.json()
    expect(json.success).toBe(true)
    expect(json.content_en).toBe('Hello')
    expect(hoistedMocks.generateTextMock).toHaveBeenCalled()
  })

  it('works with different providers', async () => {
    for (const provider of ['google', 'anthropic', 'deepseek', 'openrouter']) {
      vi.clearAllMocks()

      hoistedMocks.createClientMock.mockReturnValue(
        createMockSupabase({
          user: { id: 'user-1' },
          message: {
            id: 'msg-1',
            chat_id: 'chat-1',
            role: 'user',
            content: '안녕하세요',
            content_en: null,
            user_id: 'user-1',
          },
          profile: { translation_api_key_id: 'key-1' },
          apiKey: {
            id: 'key-1',
            user_id: 'user-1',
            provider,
            model_preference: 'model-1',
            vault_secret_name: 'vault-key',
            is_active: true,
          },
        }),
      )
      hoistedMocks.createAdminClientMock.mockReturnValue(createMockAdminSupabase())
      hoistedMocks.generateTextMock.mockResolvedValue({ text: 'Hello' })

      const response = await POST(createRequest({ messageId: 'msg-1' }))

      expect(response.status).toBe(200)
    }
  })
})
