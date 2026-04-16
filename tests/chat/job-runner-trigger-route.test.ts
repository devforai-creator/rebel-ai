import { beforeEach, describe, expect, it, vi, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { __resetChatRunnerTriggerStatsForTest } from '@/lib/chat/runner-trigger-monitor'

const processChatJobsMock = vi.fn()

vi.mock('@/app/api/internal/chat-job-runner/service', () => ({
  processChatJobs: (...args: unknown[]) => processChatJobsMock(...args),
}))

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
    __resetChatRunnerTriggerStatsForTest()
    processChatJobsMock.mockReset()
    processChatJobsMock.mockResolvedValue({
      processedCount: 2,
      results: [],
    })
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 202 immediately with fire-and-forget trigger', async () => {
    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer cron-secret'))
    const body = await response.json()

    // Fire-and-forget: returns 202 immediately
    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
    expect(body.timestamp).toBeDefined()
    expect(body.triggerStats).toBeDefined()
    expect(processChatJobsMock).toHaveBeenCalledTimes(1)
    expect(processChatJobsMock).toHaveBeenCalledWith(2)
  })

  it('returns 202 even when background processing fails (fire-and-forget)', async () => {
    processChatJobsMock.mockRejectedValueOnce(new Error('runner failed'))

    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer cron-secret'))
    const body = await response.json()

    // Fire-and-forget: still returns 202, error handled in background
    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
    expect(processChatJobsMock).toHaveBeenCalledTimes(1)
  })

  it('returns 401 for invalid auth header', async () => {
    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer wrong-secret'))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(processChatJobsMock).not.toHaveBeenCalled()
  })

  it('returns 500 when secrets not configured', async () => {
    delete process.env.CHAT_ADMIN_SECRET

    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('Server misconfigured')
    expect(processChatJobsMock).not.toHaveBeenCalled()
  })

  it('allows admin-authenticated dispatch even when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET

    const { GET } = await import('@/app/api/internal/chat-job-runner/trigger/route')
    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body.triggered).toBe(true)
    expect(processChatJobsMock).toHaveBeenCalledTimes(1)
  })
})
