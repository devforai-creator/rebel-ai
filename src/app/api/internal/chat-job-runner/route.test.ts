import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const processChatJobsMock = vi.fn()

vi.mock('./service', () => ({
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

function buildRequest(body: unknown, auth?: string) {
  return new NextRequest('http://localhost/api/internal/chat-job-runner', {
    method: 'POST',
    headers: auth ? { authorization: auth } : undefined,
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/chat-job-runner', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    processChatJobsMock.mockReset()
  })

  it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(500)
  })

  it('returns 401 when secret does not match', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}, 'Bearer wrong'))

    expect(response.status).toBe(401)
  })

  it('runs jobs synchronously by default', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    processChatJobsMock.mockResolvedValueOnce({
      processedCount: 1,
      results: [{ jobId: 'job-1', status: 'success' }],
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest({ limit: 2 }, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      processedCount: 1,
      results: [{ jobId: 'job-1', status: 'success' }],
    })
    expect(processChatJobsMock).toHaveBeenCalledWith(2)
  })

  it('returns 202 and dispatches jobs in the background when dispatch=true', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    processChatJobsMock.mockResolvedValueOnce({
      processedCount: 1,
      results: [{ jobId: 'job-1', status: 'success' }],
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest({ limit: 3, dispatch: true }, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toEqual({
      accepted: true,
      dispatched: true,
    })
    expect(processChatJobsMock).toHaveBeenCalledWith(3)
  })
})
