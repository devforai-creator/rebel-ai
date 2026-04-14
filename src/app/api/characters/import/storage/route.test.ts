import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('@/lib/internal-api-origin', () => ({
  buildInternalApiUrl: (path: string) => new URL(`http://localhost${path}`),
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

import { POST } from './route'
import { ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE } from '@/lib/queue/admission'
import { MAX_IMPORT_UPLOAD_BYTES, IMPORT_UPLOAD_BUCKET } from '@/lib/import/constants'

type DbError = { message: string; code?: string }

type ImportJobRow = {
  id: string
  user_id: string
  status: 'pending' | 'processing' | 'success' | 'error'
  storage_path: string
  original_filename: string
  file_type: string | null
  rights_status?: string
  rights_attested?: boolean
  license_type?: string
}

type Fixture = {
  user: { id: string } | null
  userError?: DbError | null
  jobs?: ImportJobRow[]
  activeJobsError?: DbError | null
  insertJobError?: DbError | null
  cleanupError?: DbError | null
  insertedJobId?: string
}

type Predicate<T> = (row: T) => boolean

class ImportJobsTable {
  constructor(
    private readonly owner: RouteSupabaseMock,
    private readonly rows: ImportJobRow[],
  ) {}

  select() {
    const filters: Predicate<ImportJobRow>[] = []
    let limitCount: number | null = null

    const builder = {
      eq: (field: keyof ImportJobRow, value: unknown) => {
        filters.push((row) => row[field] === value)
        return builder
      },
      in: (field: keyof ImportJobRow, values: unknown[]) => {
        filters.push((row) => values.includes(row[field]))
        return builder
      },
      limit: (value: number) => {
        limitCount = value
        return builder
      },
      then: <TResult1 = unknown, TResult2 = never>(
        onfulfilled?:
          | ((value: {
              data: ImportJobRow[] | null
              error: DbError | null
            }) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => {
        if (this.owner.fixture.activeJobsError) {
          return Promise.resolve({
            data: null,
            error: this.owner.fixture.activeJobsError,
          }).then(onfulfilled, onrejected)
        }

        const filtered = this.rows.filter((row) => filters.every((predicate) => predicate(row)))
        const data = limitCount === null ? filtered : filtered.slice(0, limitCount)
        return Promise.resolve({ data, error: null as null }).then(onfulfilled, onrejected)
      },
    }

    return builder
  }

  insert(payload: Omit<ImportJobRow, 'id' | 'status'>) {
    this.owner.insertPayloads.push(payload)

    return {
      select: () => ({
        single: async () => {
          if (this.owner.fixture.insertJobError) {
            return { data: null, error: this.owner.fixture.insertJobError }
          }

          const insertedRow: ImportJobRow = {
            id: this.owner.fixture.insertedJobId ?? `import-job-${this.rows.length + 1}`,
            status: 'pending',
            ...payload,
          }
          this.rows.push(insertedRow)
          return {
            data: insertedRow,
            error: null,
          }
        },
      }),
    }
  }
}

class RouteSupabaseMock {
  readonly removedPaths: string[] = []
  readonly removedBuckets: string[] = []
  readonly jobs: ImportJobRow[]
  readonly insertPayloads: Array<Omit<ImportJobRow, 'id' | 'status'>> = []

  constructor(readonly fixture: Fixture) {
    this.jobs = [...(fixture.jobs ?? [])]
  }

  auth = {
    getUser: async () => ({
      data: { user: this.fixture.user },
      error: this.fixture.userError ?? null,
    }),
  }

  storage = {
    from: (bucket: string) => ({
      remove: async (paths: string[]) => {
        this.removedBuckets.push(bucket)
        this.removedPaths.push(...paths)
        return { data: [], error: this.fixture.cleanupError ?? null }
      },
    }),
  }

  from(table: string) {
    if (table !== 'charx_import_jobs') {
      throw new Error(`Unsupported table: ${table}`)
    }
    return new ImportJobsTable(this, this.jobs)
  }
}

function createSupabaseMock(fixture: Fixture) {
  const mock = new RouteSupabaseMock(fixture)
  createClientMock.mockReturnValue(mock)
  return mock
}

function buildRequest(body: string | Record<string, unknown>) {
  return new Request('http://localhost/api/characters/import/storage', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
    },
  })
}

async function runQueuedBackgroundTask() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('POST /api/characters/import/storage', () => {
  beforeEach(() => {
    restoreEnv()
    vi.useFakeTimers()
    createClientMock.mockReset()
    consoleErrorSpy.mockClear()
    consoleWarnSpy.mockClear()
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => 'ok',
    } as Response)
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  afterAll(() => {
    restoreEnv()
    global.fetch = ORIGINAL_FETCH
    consoleErrorSpy.mockRestore()
    consoleWarnSpy.mockRestore()
  })

  it('returns 400 for malformed JSON', async () => {
    const response = await POST(buildRequest('{') as never)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Invalid request body',
      code: 'invalid_json',
    })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the file extension is not .rbx', async () => {
    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.zip',
        fileName: 'new-file.zip',
        fileType: 'application/zip',
      }) as never,
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Supported files: .rbx only' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('returns 401 when Supabase auth returns no user', async () => {
    createSupabaseMock({
      user: null,
      userError: { message: 'missing session' },
    })

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.rbx',
      }) as never,
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when the staged path is outside the user scope', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
    })

    const response = await POST(
      buildRequest({
        path: 'other-user/imports/new-file.rbx',
        fileName: 'new-file.rbx',
      }) as never,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Access denied' })
    expect(supabase.removedPaths).toEqual([])
  })

  it('returns 413 and cleans up the staged upload when the file is oversized', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
    })

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/too-large.rbx',
        fileName: 'too-large.rbx',
        fileType: 'application/octet-stream',
        fileSize: MAX_IMPORT_UPLOAD_BYTES + 1,
      }) as never,
    )
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toContain('exceeds the 100MB server limit')
    expect(supabase.removedBuckets).toEqual([IMPORT_UPLOAD_BUCKET])
    expect(supabase.removedPaths).toEqual(['user-1/imports/too-large.rbx'])
  })

  it('logs cleanup failures while still returning the original oversized-file error', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      cleanupError: { message: 'remove failed' },
    })

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/too-large.rbx',
        fileName: 'too-large.rbx',
        fileSize: MAX_IMPORT_UPLOAD_BYTES + 1,
      }) as never,
    )

    expect(response.status).toBe(413)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][storage] Failed to remove staged upload:',
      expect.objectContaining({
        path: 'user-1/imports/too-large.rbx',
        error: { message: 'remove failed' },
      }),
    )
  })

  it('returns 500 and cleans up the staged upload when active job inspection fails', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      activeJobsError: { message: 'db down', code: 'XX001' },
    })

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.rbx',
      }) as never,
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to inspect active imports' })
    expect(supabase.removedPaths).toEqual(['user-1/imports/new-file.rbx'])
  })

  it('returns 409 and deletes the staged upload when the user already has an active import', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      jobs: [
        {
          id: 'import-1',
          user_id: 'user-1',
          status: 'processing',
          storage_path: 'user-1/imports/existing.rbx',
          original_filename: 'existing.rbx',
          file_type: 'application/octet-stream',
        },
      ],
    })

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.rbx',
        fileType: 'application/octet-stream',
        fileSize: 1024,
      }) as never,
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({
      error: ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE,
      existingJobId: 'import-1',
    })
    expect(supabase.removedPaths).toEqual(['user-1/imports/new-file.rbx'])
    expect(supabase.jobs).toHaveLength(1)
  })

  it('returns 409 on unique-violation enqueue conflicts and cleans up the staged upload', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      insertJobError: { message: 'duplicate key', code: '23505' },
    })

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.rbx',
      }) as never,
    )

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE })
    expect(supabase.removedPaths).toEqual(['user-1/imports/new-file.rbx'])
  })

  it('returns 500 on generic enqueue failures and cleans up the staged upload', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      insertJobError: { message: 'insert failed', code: 'XX002' },
    })

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.rbx',
      }) as never,
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to enqueue import job' })
    expect(supabase.removedPaths).toEqual(['user-1/imports/new-file.rbx'])
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][storage] Failed to enqueue job:',
      { message: 'insert failed', code: 'XX002' },
    )
  })

  it('enqueues the import job and warns when CHAT_ADMIN_SECRET is missing', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      insertedJobId: 'job-123',
    })
    delete process.env.CHAT_ADMIN_SECRET

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.RBX',
        fileType: null,
      }) as never,
    )
    const body = await response.json()
    await runQueuedBackgroundTask()

    expect(response.status).toBe(200)
    expect(body).toEqual({ jobId: 'job-123', status: 'pending' })
    expect(supabase.insertPayloads).toEqual([
      {
        user_id: 'user-1',
        storage_path: 'user-1/imports/new-file.rbx',
        original_filename: 'new-file.RBX',
        file_type: null,
        rights_status: 'self_owned',
        rights_attested: true,
        license_type: 'self_owned',
      },
    ])
    expect(global.fetch).not.toHaveBeenCalled()
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[Character Import][storage] CHAT_ADMIN_SECRET not configured – background jobs will rely on external runners.',
    )
  })

  it('calls the trigger route with auth headers and logs non-ok responses', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      insertedJobId: 'job-234',
    })
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypass-secret'
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'runner unavailable',
    } as Response)

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.rbx',
      }) as never,
    )
    await runQueuedBackgroundTask()

    expect(response.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(
      new URL('http://localhost/api/internal/character-import-runner/trigger?jobId=job-234'),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer admin-secret',
          'x-vercel-protection-bypass': 'bypass-secret',
        }),
        signal: expect.any(AbortSignal),
      }),
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][storage] Failed to trigger runner route',
      503,
      'runner unavailable',
    )
  })

  it('warns when the background trigger aborts', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      insertedJobId: 'job-345',
    })
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue({
      name: 'AbortError',
    })

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.rbx',
      }) as never,
    )
    await runQueuedBackgroundTask()

    expect(response.status).toBe(200)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][storage] Runner trigger timed out after 5s',
      { jobId: 'job-345' },
    )
  })

  it('logs unexpected trigger errors without failing the request', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      insertedJobId: 'job-456',
    })
    process.env.CHAT_ADMIN_SECRET = 'admin-secret'
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network down'),
    )

    const response = await POST(
      buildRequest({
        path: 'user-1/imports/new-file.rbx',
        fileName: 'new-file.rbx',
      }) as never,
    )
    await runQueuedBackgroundTask()

    expect(response.status).toBe(200)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][storage] Runner trigger error:',
      expect.any(Error),
    )
  })
})
