import { beforeEach, describe, expect, it, vi, afterEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { __resetChatRunnerTriggerStatsForTest } from '@/lib/chat/runner-trigger-monitor'

vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server')
  return {
    ...actual,
    after: vi.fn((cb: () => void | Promise<void>) => {
      cb()
    }),
  }
})

const ORIGINAL_ENV = { ...process.env }
const originalFetch = global.fetch

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function buildRequest(authHeader?: string) {
  const url = new URL('https://app.example.com/api/internal/chat-job-runner/trigger')
  return new NextRequest(url, {
    method: 'GET',
    headers: authHeader ? new Headers({ authorization: authHeader }) : new Headers(),
  })
}

describe('chat job runner trigger route', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.INTERNAL_API_ORIGIN = 'https://internal.example.com'
    __resetChatRunnerTriggerStatsForTest()
  })

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch
    }
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 202 immediately with fire-and-forget trigger', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    global.fetch = fetchMock as typeof fetch

    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer cron-secret'))
    const body = await response.json()

    // Fire-and-forget: returns 202 immediately
    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
    expect(body.timestamp).toBeDefined()
    expect(body.triggerStats).toBeDefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('https://internal.example.com/api/internal/chat-job-runner'),
      {
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer admin-secret',
        }),
        body: JSON.stringify({ limit: 2, dispatch: true }),
        signal: expect.any(AbortSignal),
      },
    )
  })

  it('returns 202 even when fetch fails (fire-and-forget)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    global.fetch = fetchMock as typeof fetch

    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer cron-secret'))
    const body = await response.json()

    // Fire-and-forget: still returns 202, error handled in background
    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 401 for invalid auth header', async () => {
    const fetchMock = vi.fn()
    global.fetch = fetchMock as typeof fetch

    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer wrong-secret'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 500 when secrets not configured', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    const fetchMock = vi.fn()
    global.fetch = fetchMock as typeof fetch

    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Server misconfigured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows admin-authenticated dispatch even when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ accepted: true, dispatched: true }), {
        status: 202,
      }),
    )
    global.fetch = fetchMock as typeof fetch

    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
