import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const createAdminClientMock = vi.fn(() => ({ admin: true }))
const resetStuckProcessingJobsMock = vi.fn()
const resetStuckImportProcessingJobsMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/chat/job-queue', () => ({
  resetStuckProcessingJobs: (...args: unknown[]) => resetStuckProcessingJobsMock(...args),
}))

vi.mock('@/lib/import/job-queue', () => ({
  resetStuckImportProcessingJobs: (...args: unknown[]) =>
    resetStuckImportProcessingJobsMock(...args),
}))

function buildRequest(auth?: string) {
  return new NextRequest('http://localhost/api/internal/job-janitor', {
    method: 'GET',
    headers: auth ? { authorization: auth } : undefined,
  })
}

describe('GET /api/internal/job-janitor', () => {
  beforeEach(() => {
    restoreEnv()
    createAdminClientMock.mockReset()
    resetStuckProcessingJobsMock.mockReset()
    resetStuckImportProcessingJobsMock.mockReset()
    createAdminClientMock.mockReturnValue({ admin: true })
    resetStuckProcessingJobsMock.mockResolvedValue(2)
    resetStuckImportProcessingJobsMock.mockResolvedValue(1)
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 500 when required secrets are missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    delete process.env.CRON_SECRET
    const { GET } = await import('./route')

    const response = await GET(buildRequest())

    expect(response.status).toBe(500)
  })

  it('returns 401 when authorization is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest())

    expect(response.status).toBe(401)
  })

  it('accepts CRON_SECRET bearer auth and runs both janitors', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest('Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.recovered).toEqual({
      chatJobs: 2,
      importJobs: 1,
    })
    expect(resetStuckProcessingJobsMock).toHaveBeenCalledOnce()
    expect(resetStuckImportProcessingJobsMock).toHaveBeenCalledOnce()
  })

  it('accepts CHAT_ADMIN_SECRET bearer auth', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest('Bearer admin-secret'))

    expect(response.status).toBe(200)
  })
})
