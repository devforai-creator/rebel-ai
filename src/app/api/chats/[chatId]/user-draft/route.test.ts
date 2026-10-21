import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { USER_DRAFT_MAX_REQUEST_BYTES } from '@/lib/chat/user-draft-contract'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  rateLimit: vi.fn(),
  generate: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/chat/rate-limiter', () => ({ checkUserRateLimit: mocks.rateLimit }))
vi.mock('@/lib/chat/user-draft-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chat/user-draft-service')>()),
  generateUserDraft: mocks.generate,
}))

import { POST } from './route'
import { UserDraftError } from '@/lib/chat/user-draft-service'

const context = { params: Promise.resolve({ chatId: 'chat-1' }) }
function request(body: unknown = { apiKeyId: 'key-1', modelName: 'gpt-5.4' }) {
  return new Request('http://localhost/api/chats/chat-1/user-draft', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createClient.mockResolvedValue({ auth: { getUser: mocks.getUser } })
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  mocks.rateLimit.mockResolvedValue({ allowed: true, retryAfter: null })
  mocks.generate.mockResolvedValue({ content: 'A user draft' })
})
afterEach(() => vi.restoreAllMocks())

describe('POST user-draft', () => {
  it('returns a draft without submitting a chat message', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({ content: 'A user draft' })
    expect(mocks.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        chatId: 'chat-1',
        request: { apiKeyId: 'key-1', modelName: 'gpt-5.4', instruction: '' },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('passes the short writing intent to generation', async () => {
    await POST(
      request({ apiKeyId: 'key-1', modelName: 'gpt-5.4', instruction: '정중하게 거절한다' }),
      context,
    )
    expect(mocks.generate.mock.calls[0][0].request.instruction).toBe('정중하게 거절한다')
  })

  it('returns provider cache usage alongside the draft', async () => {
    const result = {
      content: 'A user draft',
      usage: {
        provider: 'deepseek',
        modelName: 'deepseek-v4-flash',
        memoryMode: 'prefix_live_blocks',
        inputTokens: 10000,
        outputTokens: 100,
        cacheHitTokens: 8000,
        cacheMissTokens: 2000,
      },
    }
    mocks.generate.mockResolvedValue(result)
    const response = await POST(request(), context)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual(result)
  })

  it('requires authentication before using the rate limiter or model', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null })
    expect((await POST(request(), context)).status).toBe(401)
    expect(mocks.rateLimit).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('uses the existing per-user rate limit', async () => {
    mocks.rateLimit.mockResolvedValue({ allowed: false, retryAfter: 12 })
    const response = await POST(request(), context)
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('12')
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it.each([
    { apiKeyId: '', modelName: 'gpt-5.4' },
    { apiKeyId: 'key-1', modelName: '' },
    { apiKeyId: 'key-1', modelName: 'gpt-5.4', instruction: 'x'.repeat(16_001) },
    { apiKeyId: 'key-1', modelName: 'gpt-5.4', instruction: 123 },
    { apiKeyId: 'key-1', modelName: 'gpt-5.4', reasoningEffort: 'invalid' },
    { apiKeyId: 'key-1', modelName: 'gpt-5.4', messages: [] },
  ])('rejects invalid request payloads', async (body) => {
    expect((await POST(request(body), context)).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON', async () => {
    const req = new Request('http://localhost/api/chats/chat-1/user-draft', {
      method: 'POST',
      body: '{',
    })
    expect((await POST(req, context)).status).toBe(400)
  })

  it('bounds the actual body even without content-length', async () => {
    const req = new Request('http://localhost/api/chats/chat-1/user-draft', {
      method: 'POST',
      body: ' '.repeat(USER_DRAFT_MAX_REQUEST_BYTES + 1),
    })
    expect((await POST(req, context)).status).toBe(413)
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it('preserves expected service errors', async () => {
    mocks.generate.mockRejectedValue(new UserDraftError('Chat not found', 404))
    const response = await POST(request(), context)
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Chat not found' })
  })

  it('does not expose provider errors or secrets', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.generate.mockRejectedValue(new Error('secret upstream response'))
    const response = await POST(request(), context)
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('secret upstream response')
  })

  it('handles an aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    const req = new Request('http://localhost/api/chats/chat-1/user-draft', {
      method: 'POST',
      body: JSON.stringify({ apiKeyId: 'key-1', modelName: 'gpt-5.4' }),
      signal: controller.signal,
    })
    mocks.generate.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
    expect((await POST(req, context)).status).toBe(504)
  })
})
