import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const hoistedMocks = vi.hoisted(() => {
  const fetchMock = vi.fn()
  const resolveOriginMock = vi.fn()
  return { fetchMock, resolveOriginMock }
})

vi.mock('@/lib/internal-api-origin', () => ({
  resolveInternalApiOrigin: hoistedMocks.resolveOriginMock,
}))

vi.stubGlobal('fetch', hoistedMocks.fetchMock)

import { triggerMessageTranslation } from './translation-trigger'

describe('triggerMessageTranslation', () => {
  const originalEnv = process.env.CHAT_ADMIN_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    hoistedMocks.resolveOriginMock.mockReturnValue('http://localhost:3000')
    hoistedMocks.fetchMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    // Restore original env to prevent test pollution
    // Note: fetch mock is intentionally kept for all tests in this file
    if (originalEnv !== undefined) {
      process.env.CHAT_ADMIN_SECRET = originalEnv
    } else {
      delete process.env.CHAT_ADMIN_SECRET
    }
  })

  it('calls fetch with correct URL and payload', () => {
    process.env.CHAT_ADMIN_SECRET = 'test-secret'

    triggerMessageTranslation('msg-123', 'user-456')

    expect(hoistedMocks.fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/internal/translate-message',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-secret',
        },
        body: JSON.stringify({ messageId: 'msg-123', userId: 'user-456' }),
      }),
    )
  })

  it('does not call fetch when CHAT_ADMIN_SECRET is missing', () => {
    delete process.env.CHAT_ADMIN_SECRET

    triggerMessageTranslation('msg-123', 'user-456')

    expect(hoistedMocks.fetchMock).not.toHaveBeenCalled()
  })

  it('uses resolved origin from resolveInternalApiOrigin', () => {
    process.env.CHAT_ADMIN_SECRET = 'test-secret'
    hoistedMocks.resolveOriginMock.mockReturnValue('https://internal.example.com')

    triggerMessageTranslation('msg-1', 'user-1')

    expect(hoistedMocks.fetchMock).toHaveBeenCalledWith(
      'https://internal.example.com/api/internal/translate-message',
      expect.any(Object),
    )
  })

  it('does not throw when fetch fails (fire-and-forget)', async () => {
    process.env.CHAT_ADMIN_SECRET = 'test-secret'
    hoistedMocks.fetchMock.mockRejectedValue(new Error('network down'))

    // Should not throw
    expect(() => {
      triggerMessageTranslation('msg-1', 'user-1')
    }).not.toThrow()

    // Wait for the promise to settle
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(hoistedMocks.fetchMock).toHaveBeenCalled()
  })

  it('includes Authorization header with Bearer token', () => {
    process.env.CHAT_ADMIN_SECRET = 'my-super-secret'

    triggerMessageTranslation('msg-1', 'user-1')

    const callArgs = hoistedMocks.fetchMock.mock.calls[0]
    expect(callArgs[1].headers.Authorization).toBe('Bearer my-super-secret')
  })
})
