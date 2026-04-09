import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }
const originalFetch = global.fetch
const mockFetch = vi.fn()

const createAdminClientMock = vi.fn(() => ({ admin: true }))
const runStorageJanitorMock = vi.fn()

vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server')
  return {
    ...actual,
    after: vi.fn((cb: () => void | Promise<void>) => {
      cb()
    }),
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/assets/orphaned-storage-janitor', () => ({
  runStorageJanitor: (...args: unknown[]) => runStorageJanitorMock(...args),
}))

vi.mock('@/lib/internal-api-origin', () => ({
  buildInternalApiUrl: vi.fn((path: string) => `http://localhost${path}`),
}))

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function buildGetRequest(path = 'http://localhost/api/internal/storage-janitor', auth?: string) {
  return new NextRequest(path, {
    method: 'GET',
    headers: auth ? { authorization: auth } : undefined,
  })
}

function buildPostRequest(body: unknown, auth?: string) {
  return new NextRequest('http://localhost/api/internal/storage-janitor', {
    method: 'POST',
    headers: auth ? { authorization: auth } : undefined,
    body: JSON.stringify(body),
  })
}

describe('/api/internal/storage-janitor', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    mockFetch.mockReset()
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
    global.fetch = mockFetch
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  afterAll(() => {
    restoreEnv()
  })

  describe('GET trigger', () => {
    it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
      delete process.env.CHAT_ADMIN_SECRET
      process.env.CRON_SECRET = 'cron-secret'
      const { GET } = await import('./route')

      const response = await GET(buildGetRequest(undefined, 'Bearer cron-secret'))

      expect(response.status).toBe(500)
    })

    it('returns 401 when authorization is missing', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      process.env.CRON_SECRET = 'cron-secret'
      const { GET } = await import('./route')

      const response = await GET(buildGetRequest())

      expect(response.status).toBe(401)
    })

    it('accepts CRON_SECRET auth and dispatches runner with defaults', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      process.env.CRON_SECRET = 'cron-secret'
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true, dispatched: true }), {
          status: 202,
        }),
      )
      const { GET } = await import('./route')

      const response = await GET(buildGetRequest(undefined, 'Bearer cron-secret'))
      const body = await response.json()

      expect(response.status).toBe(202)
      expect(body).toMatchObject({
        triggered: true,
        mode: 'execute',
        olderThanDays: 1,
        maxDelete: 500,
      })
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost/api/internal/storage-janitor',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer admin-secret',
          }),
          body: JSON.stringify({
            dispatch: true,
            execute: true,
            olderThanDays: 1,
            maxDelete: 500,
          }),
          signal: expect.any(AbortSignal),
        }),
      )
    })

    it('supports dry-run and custom query params', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      process.env.CRON_SECRET = 'cron-secret'
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true, dispatched: true }), {
          status: 202,
        }),
      )
      const { GET } = await import('./route')

      const response = await GET(
        buildGetRequest(
          'http://localhost/api/internal/storage-janitor?dryRun=1&olderThanDays=3&maxDelete=25&sampleSize=7',
          'Bearer admin-secret',
        ),
      )

      expect(response.status).toBe(202)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            dispatch: true,
            execute: false,
            olderThanDays: 3,
            maxDelete: 25,
            sampleSize: 7,
          }),
        }),
      )
    })
  })

  describe('POST runner', () => {
    it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
      delete process.env.CHAT_ADMIN_SECRET
      const { POST } = await import('./route')

      const response = await POST(buildPostRequest({}))

      expect(response.status).toBe(500)
    })

    it('returns 401 when authorization is missing', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      const { POST } = await import('./route')

      const response = await POST(buildPostRequest({}))

      expect(response.status).toBe(401)
    })

    it('runs both janitors synchronously by default', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      const { POST } = await import('./route')

      const response = await POST(buildPostRequest({}, 'Bearer admin-secret'))
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(body.mode).toBe('execute')
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

    it('returns 202 and runs in background when dispatch=true', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      const { POST } = await import('./route')

      const response = await POST(
        buildPostRequest(
          { dispatch: true, execute: false, olderThanDays: 3, maxDelete: 25, sampleSize: 7 },
          'Bearer admin-secret',
        ),
      )
      const body = await response.json()

      expect(response.status).toBe(202)
      expect(body).toEqual({
        accepted: true,
        dispatched: true,
        mode: 'dry-run',
      })
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
})
