import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }
const originalFetch = global.fetch
const mockFetch = vi.fn()

vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server')
  return {
    ...actual,
    after: vi.fn((cb: () => void | Promise<void>) => {
      cb()
    }),
  }
})

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

vi.mock('@/lib/internal-api-origin', () => ({
  buildInternalApiUrl: vi.fn((path: string) => `http://localhost${path}`),
}))

function buildRequest(options: { authHeader?: string }) {
  const url = 'http://localhost/api/internal/charx-import-runner/trigger'
  return new NextRequest(url, {
    method: 'GET',
    headers: options.authHeader ? { authorization: options.authHeader } : undefined,
  })
}

describe('GET /api/internal/charx-import-runner/trigger', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    mockFetch.mockReset()
    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer cron-secret' }))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Server misconfigured')
  })

  it('allows admin auth when CRON_SECRET is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    delete process.env.CRON_SECRET
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer admin-secret' }))

    expect(response.status).toBe(202)
    const body = await response.json()
    expect(body.triggered).toBe(true)
  })

  it('returns 401 when no authorization provided', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest({}))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when cron auth header is wrong', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer wrong-secret' }))

    expect(response.status).toBe(401)
  })

  it('returns 401 when auth header is wrong', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer wrong-secret' }))

    expect(response.status).toBe(401)
  })

  it('authorizes with cron secret in Bearer header', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer cron-secret' }))

    expect(response.status).toBe(202)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost/api/internal/character-import-runner',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer admin-secret',
        }),
        body: JSON.stringify({ limit: 1, jobId: null, dispatch: true }),
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('authorizes with admin secret in Bearer header', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer admin-secret' }))

    expect(response.status).toBe(202)
  })

  it('returns 202 immediately after dispatching the runner', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer cron-secret' }))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
    expect(body.timestamp).toBeDefined()
  })

  it('still returns 202 when runner dispatch responds with an error status', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Runner failed' }), {
        status: 500,
      }),
    )
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer cron-secret' }))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
  })

  it('returns 202 when fetch throws', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    mockFetch.mockRejectedValueOnce(new Error('Network error'))
    const { GET } = await import('./route')

    const response = await GET(buildRequest({ authHeader: 'Bearer cron-secret' }))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
  })

  it('uses default batch limit of 1', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    delete process.env.CHARX_IMPORT_RUNNER_BATCH_LIMIT
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    const { GET } = await import('./route')

    await GET(buildRequest({ authHeader: 'Bearer cron-secret' }))

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ limit: 1, jobId: null, dispatch: true }),
      }),
    )
  })

  it('adds vercel bypass header when configured', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypass-secret'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    const { GET } = await import('./route')

    await GET(buildRequest({ authHeader: 'Bearer cron-secret' }))

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-vercel-protection-bypass': 'bypass-secret',
        }),
      }),
    )
  })

  it('forwards a specific jobId to the runner dispatch payload', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    const url = 'http://localhost/api/internal/charx-import-runner/trigger?jobId=job-123'
    const request = new NextRequest(url, {
      method: 'GET',
      headers: { authorization: 'Bearer admin-secret' },
    })
    const { GET } = await import('./route')

    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.jobId).toBe('job-123')
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ limit: 1, jobId: 'job-123', dispatch: true }),
      }),
    )
  })
})
