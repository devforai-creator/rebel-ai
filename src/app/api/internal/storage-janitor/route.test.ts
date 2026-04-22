import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }
const originalFetch = global.fetch
const mockFetch = vi.fn()
const hoistedMocks = vi.hoisted(() => {
  const afterMock = vi.fn((cb: () => void | Promise<void>) => cb())
  return { afterMock }
})
const afterMock = hoistedMocks.afterMock

const createAdminClientMock = vi.fn(() => ({ admin: true }))
const runStorageJanitorMock = vi.fn()

vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server')
  return {
    ...actual,
    after: (cb: () => void | Promise<void>) => afterMock(cb),
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

function buildRawPostRequest(body: string, auth?: string) {
  return new NextRequest('http://localhost/api/internal/storage-janitor', {
    method: 'POST',
    headers: auth ? { authorization: auth, 'content-type': 'application/json' } : undefined,
    body,
  })
}

async function flushAfterTask() {
  await afterMock.mock.results.at(-1)?.value
}

function buildJanitorSummary(
  bucket: 'character-assets' | 'module-assets',
  overrides: Partial<{
    orphanCount: number
    deletedCount: number
    objectsScanned: number
    reachedDeleteLimit: boolean
    sample: Array<{ storagePath: string; createdAt: string | null }>
  }> = {},
) {
  return {
    bucket,
    table: bucket === 'character-assets' ? 'character_assets' : 'module_assets',
    mode: 'execute',
    olderThanIso: '2026-04-10T00:00:00.000Z',
    objectsScanned: overrides.objectsScanned ?? 0,
    orphanCount: overrides.orphanCount ?? 0,
    deletedCount: overrides.deletedCount ?? 0,
    reachedDeleteLimit: overrides.reachedDeleteLimit ?? false,
    sample: overrides.sample ?? [],
  }
}

describe('/api/internal/storage-janitor', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    afterMock.mockClear()
    mockFetch.mockReset()
    createAdminClientMock.mockReset()
    runStorageJanitorMock.mockReset()
    createAdminClientMock.mockReturnValue({ admin: true })
    runStorageJanitorMock
      .mockResolvedValueOnce(buildJanitorSummary('character-assets'))
      .mockResolvedValueOnce(buildJanitorSummary('module-assets'))
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
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ accepted: true, dispatched: true }), {
          status: 202,
        }),
      )
      const { GET } = await import('./route')

      const response = await GET(buildGetRequest(undefined, 'Bearer cron-secret'))
      const body = await response.json()
      await flushAfterTask()

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
      expect(infoSpy).toHaveBeenCalledWith(
        '[Storage Janitor Trigger] Runner dispatch accepted',
        expect.objectContaining({
          endpoint: 'http://localhost/api/internal/storage-janitor',
          mode: 'execute',
          olderThanDays: 1,
          maxDelete: 500,
          sampleSize: null,
          status: 202,
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
      await flushAfterTask()

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

    it('returns 400 when query params are invalid instead of dispatching with defaults', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      process.env.CRON_SECRET = 'cron-secret'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { GET } = await import('./route')

      const response = await GET(
        buildGetRequest(
          'http://localhost/api/internal/storage-janitor?dryRun=maybe&maxDelete=oops',
          'Bearer admin-secret',
        ),
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'dryRun must be a boolean' })
      expect(mockFetch).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith('[Storage Janitor] Invalid request option', {
        error: 'dryRun must be a boolean',
      })
    })

    it('logs structured metadata when runner dispatch fails', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      process.env.CRON_SECRET = 'cron-secret'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mockFetch.mockResolvedValueOnce(new Response('dispatch failed', { status: 503 }))
      const { GET } = await import('./route')

      const response = await GET(
        buildGetRequest(
          'http://localhost/api/internal/storage-janitor?dryRun=1&olderThanDays=3&maxDelete=25&sampleSize=7',
          'Bearer cron-secret',
        ),
      )
      await flushAfterTask()

      expect(response.status).toBe(202)
      expect(errorSpy).toHaveBeenCalledWith(
        '[Storage Janitor Trigger] Runner dispatch failed',
        expect.objectContaining({
          endpoint: 'http://localhost/api/internal/storage-janitor',
          mode: 'dry-run',
          olderThanDays: 3,
          maxDelete: 25,
          sampleSize: 7,
          status: 503,
          body: 'dispatch failed',
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

    it('returns 400 instead of executing when the JSON body is malformed', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { POST } = await import('./route')

      const response = await POST(buildRawPostRequest('{', 'Bearer admin-secret'))

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' })
      expect(runStorageJanitorMock).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith('[Storage Janitor Runner] Invalid JSON body')
    })

    it('returns 400 when body options use invalid types instead of executing defaults', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const { POST } = await import('./route')

      const response = await POST(
        buildPostRequest({ execute: 'false', maxDelete: '10' }, 'Bearer admin-secret'),
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'execute must be a boolean' })
      expect(runStorageJanitorMock).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith('[Storage Janitor] Invalid request option', {
        error: 'execute must be a boolean',
      })
    })

    it('runs both janitors synchronously by default', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
      runStorageJanitorMock
        .mockReset()
        .mockResolvedValueOnce(
          buildJanitorSummary('character-assets', {
            objectsScanned: 12,
            orphanCount: 2,
            deletedCount: 2,
            sample: [
              { storagePath: 'user-a/char-1/orphan-a.png', createdAt: '2026-04-09T00:00:00.000Z' },
            ],
          }),
        )
        .mockResolvedValueOnce(
          buildJanitorSummary('module-assets', {
            objectsScanned: 5,
            orphanCount: 1,
            deletedCount: 1,
            sample: [
              {
                storagePath: 'user-a/module-1/orphan-b.png',
                createdAt: '2026-04-09T01:00:00.000Z',
              },
            ],
          }),
        )
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
      expect(infoSpy).toHaveBeenCalledWith(
        '[Storage Janitor Runner] Completed synchronous run',
        expect.objectContaining({
          mode: 'execute',
          olderThanDays: 1,
          maxDelete: 500,
          sampleSize: null,
          summary: expect.objectContaining({
            totalOrphans: 3,
            totalDeleted: 3,
            characterAssets: expect.objectContaining({
              objectsScanned: 12,
              orphanCount: 2,
              deletedCount: 2,
            }),
            moduleAssets: expect.objectContaining({
              objectsScanned: 5,
              orphanCount: 1,
              deletedCount: 1,
            }),
          }),
        }),
      )
    })

    it('returns 202 and runs in background when dispatch=true', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
      runStorageJanitorMock
        .mockReset()
        .mockResolvedValueOnce(
          buildJanitorSummary('character-assets', {
            objectsScanned: 4,
            orphanCount: 1,
            deletedCount: 0,
            sample: [
              { storagePath: 'user-z/char-9/recent.png', createdAt: '2026-04-10T03:00:00.000Z' },
            ],
          }),
        )
        .mockResolvedValueOnce(buildJanitorSummary('module-assets', { objectsScanned: 2 }))
      const { POST } = await import('./route')

      const response = await POST(
        buildPostRequest(
          { dispatch: true, execute: false, olderThanDays: 3, maxDelete: 25, sampleSize: 7 },
          'Bearer admin-secret',
        ),
      )
      const body = await response.json()
      await flushAfterTask()

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
      expect(infoSpy).toHaveBeenCalledWith(
        '[Storage Janitor Runner] Background dispatch accepted',
        expect.objectContaining({
          mode: 'dry-run',
          olderThanDays: 3,
          maxDelete: 25,
          sampleSize: 7,
        }),
      )
      expect(infoSpy).toHaveBeenCalledWith(
        '[Storage Janitor Runner] Completed background run',
        expect.objectContaining({
          mode: 'dry-run',
          olderThanDays: 3,
          maxDelete: 25,
          sampleSize: 7,
          summary: expect.objectContaining({
            totalOrphans: 1,
            totalDeleted: 0,
            characterAssets: expect.objectContaining({
              orphanCount: 1,
              objectsScanned: 4,
            }),
          }),
        }),
      )
    })

    it('returns 500 JSON when the synchronous janitor run fails', async () => {
      process.env.CHAT_ADMIN_SECRET = 'admin-secret'
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      runStorageJanitorMock.mockReset().mockRejectedValueOnce(new Error('storage exploded'))
      const { POST } = await import('./route')

      const response = await POST(
        buildPostRequest(
          { execute: true, olderThanDays: 3, maxDelete: 25, sampleSize: 7 },
          'Bearer admin-secret',
        ),
      )

      expect(response.status).toBe(500)
      await expect(response.json()).resolves.toEqual({
        error: 'Storage janitor run failed',
      })
      expect(errorSpy).toHaveBeenCalledWith('[Storage Janitor Runner] Synchronous run failed', {
        mode: 'execute',
        olderThanDays: 3,
        maxDelete: 25,
        sampleSize: 7,
        error: 'storage exploded',
      })
    })
  })
})
