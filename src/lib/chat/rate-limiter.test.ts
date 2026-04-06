import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const internalApiUrl = 'https://internal.test/api/internal/chat-admin'

vi.mock('@/lib/internal-api-origin', () => ({
  buildInternalApiUrlForEdge: vi.fn(() => internalApiUrl),
}))

type ParsedPayload = {
  requester: string
  action: 'checkAnonRateLimit' | 'checkUserRateLimit'
  args: Record<string, unknown>
}

describe('rate limiter', () => {
  const originalEnv = { ...process.env }
  let fetchMock: ReturnType<typeof vi.fn>
  let lastPayload: ParsedPayload | null = null

  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    process.env = { ...originalEnv, CHAT_ADMIN_SECRET: 'secret' }
    fetchMock = vi.fn(async (_url, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body.toString()) : null
      lastPayload = body
      return new Response(JSON.stringify({ data: [{ allowed: true, retry_after: 0 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    lastPayload = null
  })

  it('builds deterministic client identifiers and enforces length limit', async () => {
    const { buildClientIdentifier } = await import('./rate-limiter')

    expect(buildClientIdentifier('')).toBe('anonymous-unknown')

    const longIdentifier = 'a'.repeat(2048)
    const hashed = buildClientIdentifier(longIdentifier)
    expect(hashed.startsWith('ua:')).toBe(true)
    expect(hashed.length).toBeLessThanOrEqual(256)
  })

  it('calls chat-admin for user rate limit with auth header', async () => {
    const { checkUserRateLimit } = await import('./rate-limiter')

    const result = await checkUserRateLimit('user-123')

    expect(result).toEqual({ allowed: true, retryAfter: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    })
    expect(lastPayload).toMatchObject({
      requester: 'user-123',
      action: 'checkUserRateLimit',
      args: expect.objectContaining({
        target_user_id: 'user-123',
      }),
    })
  })

  it('returns retryAfter when rate limit is exceeded', async () => {
    fetchMock.mockImplementationOnce(async (_url, init?: RequestInit) => {
      lastPayload = init?.body ? JSON.parse(init.body.toString()) : null
      return new Response(JSON.stringify({ data: [{ allowed: false, retry_after: 12 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const { checkAnonRateLimit } = await import('./rate-limiter')

    const result = await checkAnonRateLimit('198.51.100.5')

    expect(result.allowed).toBe(false)
    expect(result.retryAfter).toBe(12)
    expect(lastPayload).toMatchObject({
      requester: 'anonymous-user',
      action: 'checkAnonRateLimit',
    })
    expect((lastPayload?.args as { identifier?: string })?.identifier).toMatch(/^ua:/)
  })

  it('falls back to default window when user rate-limit payload is missing', async () => {
    fetchMock.mockImplementationOnce(async (_url, init?: RequestInit) => {
      lastPayload = init?.body ? JSON.parse(init.body.toString()) : null
      return new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const { checkUserRateLimit } = await import('./rate-limiter')

    const result = await checkUserRateLimit('user-123')
    expect(result).toEqual({ allowed: false, retryAfter: 60 })
  })

  it('clamps anon retryAfter to at least one second', async () => {
    fetchMock.mockImplementationOnce(async (_url, init?: RequestInit) => {
      lastPayload = init?.body ? JSON.parse(init.body.toString()) : null
      return new Response(JSON.stringify({ data: [{ allowed: false, retry_after: 0 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const { checkAnonRateLimit } = await import('./rate-limiter')

    const result = await checkAnonRateLimit('203.0.113.17')
    expect(result).toEqual({ allowed: false, retryAfter: 1 })
  })

  it('uses default anon retry window when retry_after is not a number', async () => {
    fetchMock.mockImplementationOnce(async (_url, init?: RequestInit) => {
      lastPayload = init?.body ? JSON.parse(init.body.toString()) : null
      return new Response(JSON.stringify({ data: [{ allowed: false, retry_after: null }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    const { checkAnonRateLimit } = await import('./rate-limiter')

    const result = await checkAnonRateLimit('203.0.113.99')
    expect(result).toEqual({ allowed: false, retryAfter: 60 })
  })

  it('adds Vercel protection bypass header when configured', async () => {
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypass-secret'
    const { checkUserRateLimit } = await import('./rate-limiter')

    await checkUserRateLimit('user-123')

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.headers).toMatchObject({
      'x-vercel-protection-bypass': 'bypass-secret',
    })
  })

  it('throws detailed error when chat-admin returns a non-OK response', async () => {
    fetchMock.mockImplementationOnce(async (_url, init?: RequestInit) => {
      lastPayload = init?.body ? JSON.parse(init.body.toString()) : null
      return new Response('denied', { status: 500 })
    })
    const { checkUserRateLimit } = await import('./rate-limiter')

    await expect(checkUserRateLimit('user-123')).rejects.toThrow(
      'Chat admin request failed (500): denied',
    )
  })

  it('throws when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    const { checkUserRateLimit } = await import('./rate-limiter')

    await expect(checkUserRateLimit('user-123')).rejects.toThrow('CHAT_ADMIN_SECRET')
  })
})
