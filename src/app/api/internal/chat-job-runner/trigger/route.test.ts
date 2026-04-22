import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const processChatJobsMock = vi.fn()
const recordChatRunnerTriggerSuccessMock = vi.fn()
const recordChatRunnerTriggerFailureMock = vi.fn()
const getChatRunnerTriggerStatsMock = vi.fn(() => ({
  totalSuccesses: 0,
  totalFailures: 0,
}))

vi.mock('../service', () => ({
  processChatJobs: (...args: unknown[]) => processChatJobsMock(...args),
}))

vi.mock('@/lib/chat/runner-trigger-monitor', () => ({
  recordChatRunnerTriggerSuccess: (...args: unknown[]) =>
    recordChatRunnerTriggerSuccessMock(...args),
  recordChatRunnerTriggerFailure: (...args: unknown[]) =>
    recordChatRunnerTriggerFailureMock(...args),
  getChatRunnerTriggerStats: () => getChatRunnerTriggerStatsMock(),
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

function buildRequest(auth?: string) {
  return new NextRequest('http://localhost/api/internal/chat-job-runner/trigger', {
    method: 'GET',
    headers: auth ? { authorization: auth } : undefined,
  })
}

describe('GET /api/internal/chat-job-runner/trigger', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    processChatJobsMock.mockReset()
    recordChatRunnerTriggerSuccessMock.mockReset()
    recordChatRunnerTriggerFailureMock.mockReset()
    getChatRunnerTriggerStatsMock.mockClear()
  })

  it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest('Bearer cron-secret'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Server misconfigured' })
  })

  it('allows admin auth when CRON_SECRET is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    delete process.env.CRON_SECRET
    processChatJobsMock.mockResolvedValueOnce({ processedCount: 1 })
    const { GET } = await import('./route')

    const response = await GET(buildRequest('Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toMatchObject({
      triggered: true,
      triggerStats: {
        totalSuccesses: 0,
        totalFailures: 0,
      },
    })
    expect(processChatJobsMock).toHaveBeenCalledWith(2)
    expect(recordChatRunnerTriggerSuccessMock).toHaveBeenCalledWith({
      attempt: 1,
      status: 202,
      processedCount: 1,
    })
  })

  it('returns 401 when authorization is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('authorizes with CRON_SECRET when configured', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    process.env.CHAT_JOB_RUNNER_BATCH_LIMIT = '3'
    processChatJobsMock.mockResolvedValueOnce({ processedCount: 2 })
    const { GET } = await import('./route')

    const response = await GET(buildRequest('Bearer cron-secret'))

    expect(response.status).toBe(202)
    expect(processChatJobsMock).toHaveBeenCalledWith(3)
  })

  it('records failures from background processing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    processChatJobsMock.mockRejectedValueOnce(new Error('runner exploded'))
    const { GET } = await import('./route')

    const response = await GET(buildRequest('Bearer admin-secret'))

    expect(response.status).toBe(202)
    expect(recordChatRunnerTriggerFailureMock).toHaveBeenCalledWith(expect.any(Error), {
      attempt: 1,
    })
  })
})
