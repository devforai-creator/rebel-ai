import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const hoistedMocks = vi.hoisted(() => {
  const createClientMock = vi.fn()
  return { createClientMock }
})

const createClientMock = hoistedMocks.createClientMock
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('@/lib/internal-api-origin', () => ({
  buildInternalApiUrl: (path: string) => new URL(`http://localhost${path}`),
}))

type DbError = { message: string; code?: string | null }

type JobRow = {
  id: string
  user_id: string
  status: 'pending' | 'processing' | 'success' | 'error'
  error_message: string | null
  result: Record<string, unknown> | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

type RouteFixture = {
  user?: { id: string } | null
  userError?: DbError | null
  job?: JobRow | null
  queryError?: DbError | null
}

function createSupabaseMock(fixture: RouteFixture = {}) {
  const user = fixture.user === undefined ? { id: 'user-1' } : fixture.user

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: fixture.userError ?? null,
      }),
    },
    from(table: string) {
      if (table !== 'charx_import_jobs') {
        throw new Error(`Unexpected table: ${table}`)
      }

      const filters: Array<[string, unknown]> = []
      const builder = {
        select: vi.fn(() => builder),
        eq(field: string, value: unknown) {
          filters.push([field, value])
          return builder
        },
        single: vi.fn(async () => {
          if (fixture.queryError) {
            return { data: null, error: fixture.queryError }
          }

          const job = fixture.job
          if (!job) {
            return { data: null, error: { code: 'PGRST116', message: 'not found' } }
          }

          const idFilter = filters.find(([field]) => field === 'id')?.[1]
          const userIdFilter = filters.find(([field]) => field === 'user_id')?.[1]

          if (job.id !== idFilter || job.user_id !== userIdFilter) {
            return { data: null, error: { code: 'PGRST116', message: 'not found' } }
          }

          return { data: job, error: null }
        }),
      }

      return builder
    },
  }
}

function buildRequest(jobId: string) {
  return new NextRequest(`http://localhost/api/characters/import/jobs/${jobId}`)
}

function buildContext(jobId: string) {
  return {
    params: Promise.resolve({ id: jobId }),
  }
}

function buildStaleJob(overrides: Partial<JobRow> = {}): JobRow {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    user_id: 'user-1',
    status: 'processing',
    error_message: null,
    result: null,
    created_at: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    started_at: null,
    completed_at: null,
    ...overrides,
  }
}

describe('GET /api/characters/import/jobs/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    createClientMock.mockReset()
    consoleWarnSpy.mockClear()
    consoleErrorSpy.mockClear()
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ updated: false }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    )
  })

  afterAll(() => {
    restoreEnv()
    global.fetch = ORIGINAL_FETCH
    consoleWarnSpy.mockRestore()
    consoleErrorSpy.mockRestore()
  })

  it('warns and skips timeout marking when CHAT_ADMIN_SECRET is missing', async () => {
    const job = buildStaleJob()
    createClientMock.mockResolvedValue(
      createSupabaseMock({
        job,
      }),
    )
    delete process.env.CHAT_ADMIN_SECRET
    const { GET } = await import('./route')

    const response = await GET(buildRequest(job.id), buildContext(job.id) as never)

    expect(global.fetch).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Character Import][jobs] CHAT_ADMIN_SECRET not configured, cannot mark job timeout',
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      id: job.id,
      status: 'processing',
      error: null,
    })
  })

  it('reads CHAT_ADMIN_SECRET at request time when calling the timeout route', async () => {
    const job = buildStaleJob()
    createClientMock.mockResolvedValue(
      createSupabaseMock({
        job,
      }),
    )
    process.env.CHAT_ADMIN_SECRET = 'old-secret'
    const { GET } = await import('./route')

    process.env.CHAT_ADMIN_SECRET = 'new-secret'

    const response = await GET(buildRequest(job.id), buildContext(job.id) as never)

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      new URL('http://localhost/api/internal/import-job-timeout'),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer new-secret',
        },
        body: JSON.stringify({
          jobId: job.id,
          jobType: 'charx',
          userId: 'user-1',
          errorMessage: 'Character import timed out. Please retry.',
        }),
        signal: expect.any(AbortSignal),
      },
    )
  })

  it('uses the shared import processing timeout env when deciding whether a job is stale', async () => {
    const job = buildStaleJob({
      created_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    })
    createClientMock.mockResolvedValue(
      createSupabaseMock({
        job,
      }),
    )
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.CHARACTER_IMPORT_JOB_PROCESSING_TIMEOUT_MS = '300000'
    const { GET } = await import('./route')

    const response = await GET(buildRequest(job.id), buildContext(job.id) as never)

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      new URL('http://localhost/api/internal/import-job-timeout'),
      expect.objectContaining({
        method: 'POST',
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('fails open when the timeout route call aborts', async () => {
    const job = buildStaleJob()
    createClientMock.mockResolvedValue(
      createSupabaseMock({
        job,
      }),
    )
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const abortError = new Error('Request timed out')
    abortError.name = 'AbortError'
    global.fetch = vi.fn().mockRejectedValueOnce(abortError)
    const { GET } = await import('./route')

    const response = await GET(buildRequest(job.id), buildContext(job.id) as never)

    expect(response.status).toBe(200)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][jobs] Timeout route timed out after 5s',
      {
        jobId: job.id,
      },
    )
    expect(await response.json()).toMatchObject({
      id: job.id,
      status: 'processing',
      error: null,
    })
  })
})
