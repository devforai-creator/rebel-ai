import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

type JobRow = {
  id: string
  user_id: string
  storage_path: string
  original_filename: string
  file_type: string | null
  status: 'pending' | 'processing' | 'error'
  updated_at: string
}

let supabaseMock: ReturnType<typeof createSupabaseMock>
const processCharacterImportJobMock = vi.fn()
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('@/lib/character-import-jobs', () => ({
  processCharacterImportJob: (...args: unknown[]) => processCharacterImportJobMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => supabaseMock),
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

function createSupabaseMock(
  jobs: JobRow[],
  options?: {
    queryError?: { code?: string; message: string } | null
    claimError?: { code?: string; message: string } | null
  },
) {
  const eqCalls: Array<[string, unknown]> = []

  return {
    eqCalls,
    jobs,
    from(table: string) {
      if (table !== 'charx_import_jobs') {
        throw new Error(`Unexpected table: ${table}`)
      }

      const tableApi = {
        select: () => tableApi,
        eq: (field: keyof JobRow, value: unknown) => {
          eqCalls.push([field, value])
          return tableApi
        },
        order: () => tableApi,
        limit: () => tableApi,
        maybeSingle: async () => {
          if (options?.queryError) {
            return {
              data: null,
              error: options.queryError,
            }
          }

          // Pending job lookup
          const pending = jobs.find((job) => job.status === 'pending')
          return pending
            ? { data: pending, error: null }
            : { data: null, error: { code: 'PGRST116' } }
        },
        update: (payload: Partial<JobRow>) => {
          const filters: Array<(job: JobRow) => boolean> = []
          return {
            eq(field: keyof JobRow, value: unknown) {
              filters.push((job) => job[field] === value)
              return this
            },
            lt(field: keyof JobRow, value: string) {
              filters.push((job) => {
                const fieldValue = job[field] as string | null
                return fieldValue ? new Date(fieldValue).toISOString() < value : false
              })
              return this
            },
            select: () => {
              return {
                async single() {
                  if (options?.claimError) {
                    return { data: null, error: options.claimError }
                  }

                  const job = jobs.find((candidate) => filters.every((fn) => fn(candidate)))
                  if (!job) {
                    return { data: null, error: { code: 'PGRST116', message: 'not found' } }
                  }
                  Object.assign(job, payload)
                  return { data: job, error: null }
                },
                then(
                  onfulfilled: (value: { data: Array<{ id: string }>; error: null }) => unknown,
                ) {
                  const targets = jobs.filter((job) => filters.every((fn) => fn(job)))
                  targets.forEach((job) => Object.assign(job, payload))
                  return Promise.resolve({
                    data: targets.map((job) => ({ id: job.id })),
                    error: null,
                  }).then(onfulfilled)
                },
              }
            },
          }
        },
      }

      return tableApi
    },
  }
}

function buildRequest(body: unknown, auth?: string) {
  return new NextRequest('http://localhost/api/internal/charx-import-runner', {
    method: 'POST',
    headers: auth ? { authorization: auth } : undefined,
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/charx-import-runner', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    processCharacterImportJobMock.mockReset()
    consoleErrorSpy.mockClear()
    supabaseMock = createSupabaseMock([])
  })

  afterAll(() => {
    consoleErrorSpy.mockRestore()
  })

  it('returns 500 when CHAT_ADMIN_SECRET is missing', async () => {
    delete process.env.CHAT_ADMIN_SECRET
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Server misconfigured' })
  })

  it('returns 401 when secret does not match', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}, 'Bearer wrong'))

    expect(response.status).toBe(401)
  })

  it('skips when jobId is provided but not found', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([])
    const { POST } = await import('./route')

    const response = await POST(buildRequest({ jobId: 'job-missing' }, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.processedCount).toBe(1)
    expect(body.processed[0]).toMatchObject({
      jobId: 'job-missing',
      status: 'skipped',
    })
  })

  it('returns 500 when querying the pending job fails', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock([], {
      queryError: { code: 'XX001', message: 'db down' },
    })
    const { POST } = await import('./route')

    const response = await POST(buildRequest({ jobId: 'job-1' }, 'Bearer admin-secret'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to claim pending import job',
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import Runner] Failed to query pending job',
      { code: 'XX001', message: 'db down' },
    )
  })

  it('returns 500 when claiming the pending job fails', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    supabaseMock = createSupabaseMock(
      [
        {
          id: 'job-1',
          user_id: 'user-1',
          storage_path: 'path/file.rbx',
          original_filename: 'file.rbx',
          file_type: 'application/json',
          status: 'pending',
          updated_at: new Date().toISOString(),
        },
      ],
      {
        claimError: { code: 'XX002', message: 'claim update failed' },
      },
    )
    const { POST } = await import('./route')

    const response = await POST(buildRequest({ jobId: 'job-1' }, 'Bearer admin-secret'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to claim pending import job',
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import Runner] Failed to claim pending job',
      { code: 'XX002', message: 'claim update failed' },
    )
  })

  it('processes pending jobs without mutating unrelated processing jobs', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const stuckJob: JobRow = {
      id: 'job-stuck',
      user_id: 'user-1',
      storage_path: 'path/stuck.rbx',
      original_filename: 'stuck.rbx',
      file_type: null,
      status: 'processing',
      updated_at: '2024-01-01T00:00:00Z',
    }
    const pendingJob: JobRow = {
      id: 'job-1',
      user_id: 'user-1',
      storage_path: 'path/file.rbx',
      original_filename: 'file.rbx',
      file_type: 'application/json',
      status: 'pending',
      updated_at: new Date().toISOString(),
    }
    supabaseMock = createSupabaseMock([stuckJob, pendingJob])
    processCharacterImportJobMock.mockResolvedValueOnce({ status: 'success' })

    const { POST } = await import('./route')
    const response = await POST(buildRequest({ limit: 2 }, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.processedCount).toBe(1)
    expect(body.processed[0]).toMatchObject({ jobId: 'job-1', status: 'success' })
    expect(processCharacterImportJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'path/file.rbx',
      }),
      supabaseMock,
    )

    // Recovery is handled by a separate janitor route, not the runner hot path.
    expect(stuckJob.status).toBe('processing')
  })

  it('returns 202 and dispatches jobs in the background when dispatch=true', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const pendingJob: JobRow = {
      id: 'job-1',
      user_id: 'user-1',
      storage_path: 'path/file.rbx',
      original_filename: 'file.rbx',
      file_type: 'application/json',
      status: 'pending',
      updated_at: new Date().toISOString(),
    }
    supabaseMock = createSupabaseMock([pendingJob])
    processCharacterImportJobMock.mockResolvedValueOnce({ status: 'success' })

    const { POST } = await import('./route')
    const response = await POST(buildRequest({ limit: 1, dispatch: true }, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(202)
    expect(body).toEqual({
      accepted: true,
      dispatched: true,
    })
    expect(processCharacterImportJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      supabaseMock,
    )
  })

  it('reports an error when the import processor returns an error result', async () => {
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    const pendingJob: JobRow = {
      id: 'job-1',
      user_id: 'user-1',
      storage_path: 'path/file.rbx',
      original_filename: 'file.rbx',
      file_type: 'application/json',
      status: 'pending',
      updated_at: new Date().toISOString(),
    }
    supabaseMock = createSupabaseMock([pendingJob])
    processCharacterImportJobMock.mockResolvedValueOnce({
      status: 'error',
      error: 'RBX import failed',
    })

    const { POST } = await import('./route')
    const response = await POST(buildRequest({ limit: 1 }, 'Bearer admin-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.processedCount).toBe(1)
    expect(body.processed[0]).toMatchObject({
      jobId: 'job-1',
      status: 'error',
      error: 'RBX import failed',
    })
  })
})
