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

type JobRow = {
  id: string
  user_id: string
  status: string
  error_message: string | null
  completed_at: string | null
}

let supabaseMock: ReturnType<typeof createSupabaseMock>

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => supabaseMock),
}))

function createSupabaseMock(options: { charxJobs?: JobRow[]; updateError?: Error | null }) {
  const { charxJobs = [], updateError = null } = options

  return {
    from(table: string) {
      if (table !== 'charx_import_jobs') {
        throw new Error(`Unexpected table: ${table}`)
      }
      const jobs = charxJobs

      const tableApi = {
        select: () => tableApi,
        eq: (field: string, value: unknown) => {
          ;(tableApi as { _filters: Array<[string, unknown]> })._filters.push([field, value])
          return tableApi
        },
        _filters: [] as Array<[string, unknown]>,
        single: async () => {
          const idFilter = tableApi._filters.find(([f]) => f === 'id')
          const job = idFilter ? jobs.find((j) => j.id === idFilter[1]) : null
          return job ? { data: job, error: null } : { data: null, error: { code: 'PGRST116' } }
        },
        update: (payload: Partial<JobRow>) => {
          const updateFilters: Array<[string, unknown]> = []
          return {
            eq(field: string, value: unknown) {
              updateFilters.push([field, value])
              return this
            },
            select: () => ({
              maybeSingle: async () => {
                if (updateError) {
                  return { data: null, error: updateError }
                }
                const idFilter = updateFilters.find(([f]) => f === 'id')
                const statusFilter = updateFilters.find(([f]) => f === 'status')
                const job = jobs.find((j) => {
                  const matchesId = !idFilter || j.id === idFilter[1]
                  const matchesStatus = !statusFilter || j.status === statusFilter[1]
                  return matchesId && matchesStatus
                })
                if (!job) {
                  return { data: null, error: null }
                }
                Object.assign(job, payload)
                return { data: job, error: null }
              },
            }),
          }
        },
      }

      return tableApi
    },
  }
}

function buildRequest(body: unknown, auth?: string) {
  return new NextRequest('http://localhost/api/internal/import-job-timeout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/import-job-timeout', () => {
  beforeEach(() => {
    vi.resetModules()
    restoreEnv()
    supabaseMock = createSupabaseMock({})
  })

  afterAll(() => {
    restoreEnv()
  })

  it('returns 401 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(401)
  })

  it('returns 401 when authorization header is missing', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(401)
  })

  it('returns 401 when secret does not match', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}, 'Bearer wrong-secret'))

    expect(response.status).toBe(401)
  })

  it('reads CHAT_ADMIN_SECRET at request time so rotated secrets take effect without reimport', async () => {
    process.env.CHAT_ADMIN_SECRET = 'old-secret'
    const { POST } = await import('./route')

    process.env.CHAT_ADMIN_SECRET = 'new-secret'

    const staleSecretResponse = await POST(buildRequest({}, 'Bearer old-secret'))
    expect(staleSecretResponse.status).toBe(401)

    const rotatedSecretResponse = await POST(buildRequest({}, 'Bearer new-secret'))
    expect(rotatedSecretResponse.status).toBe(400)
    expect(await rotatedSecretResponse.json()).toEqual({ error: 'Invalid request body' })
  })

  it('returns 400 for invalid request body', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({ invalid: 'body' }, 'Bearer admin-secret'))

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe('Invalid request body')
  })

  it('returns 400 when jobId is not a valid UUID', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          jobId: 'not-a-uuid',
          jobType: 'charx',
          userId: '550e8400-e29b-41d4-a716-446655440000',
          errorMessage: 'Timeout',
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(400)
  })

  it('returns 404 when charx job is not found', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock({ charxJobs: [] })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          jobId: '550e8400-e29b-41d4-a716-446655440000',
          jobType: 'charx',
          userId: '550e8400-e29b-41d4-a716-446655440001',
          errorMessage: 'Timeout',
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(404)
  })

  it('returns 403 when userId does not match job owner', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const jobId = '550e8400-e29b-41d4-a716-446655440000'
    supabaseMock = createSupabaseMock({
      charxJobs: [
        {
          id: jobId,
          user_id: 'different-user-id',
          status: 'processing',
          error_message: null,
          completed_at: null,
        },
      ],
    })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          jobId,
          jobType: 'charx',
          userId: '550e8400-e29b-41d4-a716-446655440001',
          errorMessage: 'Timeout',
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(403)
  })

  it('returns updated: false when job is not in processing state', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const jobId = '550e8400-e29b-41d4-a716-446655440000'
    const userId = '550e8400-e29b-41d4-a716-446655440001'
    supabaseMock = createSupabaseMock({
      charxJobs: [
        {
          id: jobId,
          user_id: userId,
          status: 'success',
          error_message: null,
          completed_at: new Date().toISOString(),
        },
      ],
    })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          jobId,
          jobType: 'charx',
          userId,
          errorMessage: 'Timeout',
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.updated).toBe(false)
    expect(body.reason).toBe('Job not in processing state')
  })

  it('returns updated: false when job status changed between read and update (race condition)', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const jobId = '550e8400-e29b-41d4-a716-446655440000'
    const userId = '550e8400-e29b-41d4-a716-446655440001'
    // Job is processing when read, but update returns null (status changed)
    const job = {
      id: jobId,
      user_id: userId,
      status: 'processing',
      error_message: null,
      completed_at: null,
    }
    supabaseMock = createSupabaseMock({ charxJobs: [job] })
    // Simulate race condition: job completes between read and update
    const originalFrom = supabaseMock.from.bind(supabaseMock)
    supabaseMock.from = (table: string) => {
      const api = originalFrom(table)
      const originalUpdate = api.update.bind(api)
      api.update = (payload: Partial<JobRow>) => {
        // Change job status before update runs
        job.status = 'success'
        return originalUpdate(payload)
      }
      return api
    }
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          jobId,
          jobType: 'charx',
          userId,
          errorMessage: 'Timeout',
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.updated).toBe(false)
    expect(body.reason).toBe('Job status changed (likely completed by runner)')
  })

  it('successfully marks charx job as timed out', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const jobId = '550e8400-e29b-41d4-a716-446655440000'
    const userId = '550e8400-e29b-41d4-a716-446655440001'
    const job = {
      id: jobId,
      user_id: userId,
      status: 'processing',
      error_message: null,
      completed_at: null,
    }
    supabaseMock = createSupabaseMock({ charxJobs: [job] })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          jobId,
          jobType: 'charx',
          userId,
          errorMessage: 'Import timed out after 90 seconds',
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.updated).toBe(true)
    expect(body.job.status).toBe('error')
    expect(body.job.error_message).toBe('Import timed out after 90 seconds')
    expect(body.job.completed_at).toBeTruthy()
  })

  it('returns 500 when database update fails', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const jobId = '550e8400-e29b-41d4-a716-446655440000'
    const userId = '550e8400-e29b-41d4-a716-446655440001'
    supabaseMock = createSupabaseMock({
      charxJobs: [
        {
          id: jobId,
          user_id: userId,
          status: 'processing',
          error_message: null,
          completed_at: null,
        },
      ],
      updateError: new Error('Database connection failed'),
    })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          jobId,
          jobType: 'charx',
          userId,
          errorMessage: 'Timeout',
        },
        'Bearer admin-secret',
      ),
    )

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error).toBe('Failed to update job')
  })
})
