import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAT_RATE_LIMITS } from './runtime-limits'

const createAdminClientMock = vi.fn()
const checkChatRateLimitMock = vi.fn()
const checkAnonRateLimitRpcMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/supabase/rpc', () => ({
  checkChatRateLimit: (...args: unknown[]) => checkChatRateLimitMock(...args),
  checkAnonRateLimitRpc: (...args: unknown[]) => checkAnonRateLimitRpcMock(...args),
}))

describe('rate limiter', () => {
  const adminClient = { rpc: vi.fn() }

  beforeEach(() => {
    vi.resetModules()
    createAdminClientMock.mockReset()
    checkChatRateLimitMock.mockReset()
    checkAnonRateLimitRpcMock.mockReset()

    createAdminClientMock.mockReturnValue(adminClient)
    checkChatRateLimitMock.mockResolvedValue({
      data: [{ allowed: true, retry_after: 0 }],
      error: null,
    })
    checkAnonRateLimitRpcMock.mockResolvedValue({
      data: [{ allowed: true, retry_after: 0 }],
      error: null,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('builds deterministic client identifiers and enforces length limit', async () => {
    const { buildClientIdentifier } = await import('./rate-limiter')

    expect(buildClientIdentifier('')).toBe('anonymous-unknown')

    const longIdentifier = 'a'.repeat(2048)
    const hashed = buildClientIdentifier(longIdentifier)
    expect(hashed.startsWith('ua:')).toBe(true)
    expect(hashed.length).toBeLessThanOrEqual(CHAT_RATE_LIMITS.maxAnonRateLimitIdentifierLength)
  })

  it('calls the rate-limit RPC directly for user rate limits', async () => {
    const { checkUserRateLimit } = await import('./rate-limiter')

    const result = await checkUserRateLimit('user-123')

    expect(result).toEqual({ allowed: true, retryAfter: null })
    expect(createAdminClientMock).toHaveBeenCalledTimes(1)
    expect(checkChatRateLimitMock).toHaveBeenCalledWith(
      adminClient,
      expect.objectContaining({
        target_user_id: 'user-123',
      }),
    )
  })

  it('returns retryAfter when anon rate limit is exceeded', async () => {
    checkAnonRateLimitRpcMock.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: 12 }],
      error: null,
    })
    const { checkAnonRateLimit } = await import('./rate-limiter')

    const result = await checkAnonRateLimit('198.51.100.5')

    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBe(12)
    expect(checkAnonRateLimitRpcMock).toHaveBeenCalledWith(
      adminClient,
      expect.objectContaining({
        identifier: expect.stringMatching(/^ua:/),
      }),
    )
  })

  it('falls back to default window when user rate-limit payload is missing', async () => {
    checkChatRateLimitMock.mockResolvedValueOnce({
      data: null,
      error: null,
    })
    const { checkUserRateLimit } = await import('./rate-limiter')

    const result = await checkUserRateLimit('user-123')
    expect(result).toEqual({ allowed: false, retryAfter: CHAT_RATE_LIMITS.userWindowSeconds })
  })

  it('clamps anon retryAfter to at least one second', async () => {
    checkAnonRateLimitRpcMock.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: 0 }],
      error: null,
    })
    const { checkAnonRateLimit } = await import('./rate-limiter')

    const result = await checkAnonRateLimit('203.0.113.17')
    expect(result).toEqual({ allowed: false, retryAfter: 1 })
  })

  it('uses default anon retry window when retry_after is not a number', async () => {
    checkAnonRateLimitRpcMock.mockResolvedValueOnce({
      data: [{ allowed: false, retry_after: null }],
      error: null,
    })
    const { checkAnonRateLimit } = await import('./rate-limiter')

    const result = await checkAnonRateLimit('203.0.113.99')
    expect(result).toEqual({ allowed: false, retryAfter: CHAT_RATE_LIMITS.anonWindowSeconds })
  })

  it('throws detailed error when user rate-limit RPC fails', async () => {
    checkChatRateLimitMock.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    })
    const { checkUserRateLimit } = await import('./rate-limiter')

    await expect(checkUserRateLimit('user-123')).rejects.toThrow(
      'check_chat_rate_limit failed (57014): statement timeout',
    )
  })

  it('throws detailed error when anon rate-limit RPC fails', async () => {
    checkAnonRateLimitRpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: '57014', message: 'statement timeout' },
    })
    const { checkAnonRateLimit } = await import('./rate-limiter')

    await expect(checkAnonRateLimit('203.0.113.77')).rejects.toThrow(
      'check_anon_rate_limit failed (57014): statement timeout',
    )
  })
})
