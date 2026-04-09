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
const runStorageJanitorMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/assets/orphaned-storage-janitor', () => ({
  runStorageJanitor: (...args: unknown[]) => runStorageJanitorMock(...args),
}))

function buildRequest(path = 'http://localhost/api/internal/storage-janitor', auth?: string) {
  return new NextRequest(path, {
    method: 'GET',
    headers: auth ? { authorization: auth } : undefined,
  })
}

describe('GET /api/internal/storage-janitor', () => {
  beforeEach(() => {
    restoreEnv()
    createAdminClientMock.mockReset()
    runStorageJanitorMock.mockReset()
    createAdminClientMock.mockReturnValue({ admin: true })
    runStorageJanitorMock
      .mockResolvedValueOnce({
        bucket: 'character-assets',
        orphanCount: 0,
      })
      .mockResolvedValueOnce({
        bucket: 'module-assets',
        orphanCount: 0,
      })
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

  it('accepts CRON_SECRET bearer auth and runs both janitors with defaults', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(buildRequest(undefined, 'Bearer cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.mode).toBe('execute')
    expect(body.olderThanDays).toBe(1)
    expect(body.maxDelete).toBe(500)
    expect(runStorageJanitorMock).toHaveBeenCalledTimes(2)
    expect(runStorageJanitorMock).toHaveBeenNthCalledWith(
      1,
      { admin: true },
      {
        bucket: 'character-assets',
        table: 'character_assets',
        olderThanDays: 1,
        maxDelete: 500,
        sampleSize: undefined,
        execute: true,
      },
    )
    expect(runStorageJanitorMock).toHaveBeenNthCalledWith(
      2,
      { admin: true },
      {
        bucket: 'module-assets',
        table: 'module_assets',
        olderThanDays: 1,
        maxDelete: 500,
        sampleSize: undefined,
        execute: true,
      },
    )
  })

  it('accepts CHAT_ADMIN_SECRET auth and supports dry-run query params', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CRON_SECRET = 'cron-secret'
    const { GET } = await import('./route')

    const response = await GET(
      buildRequest(
        'http://localhost/api/internal/storage-janitor?dryRun=1&olderThanDays=3&maxDelete=25&sampleSize=7',
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(200)
    expect(runStorageJanitorMock).toHaveBeenNthCalledWith(
      1,
      { admin: true },
      {
        bucket: 'character-assets',
        table: 'character_assets',
        olderThanDays: 3,
        maxDelete: 25,
        sampleSize: 7,
        execute: false,
      },
    )
    expect(runStorageJanitorMock).toHaveBeenNthCalledWith(
      2,
      { admin: true },
      {
        bucket: 'module-assets',
        table: 'module_assets',
        olderThanDays: 3,
        maxDelete: 25,
        sampleSize: 7,
        execute: false,
      },
    )
  })
})
