import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImportUploadTicket } from '@/lib/import/upload-ticket'

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
import { IMPORT_UPLOAD_BUCKET, MAX_IMPORT_UPLOAD_BYTES } from '@/lib/import/constants'

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
  signedUploadError?: DbError | null
  signedUploadUrl?: string
  signedUploadToken?: string
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
  readonly signedUploadRequests: Array<{ bucket: string; path: string; upsert?: boolean }> = []

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
      createSignedUploadUrl: async (path: string, options?: { upsert?: boolean }) => {
        this.signedUploadRequests.push({ bucket, path, upsert: options?.upsert })

        if (this.fixture.signedUploadError) {
          return { data: null, error: this.fixture.signedUploadError }
        }

        return {
          data: {
            path,
            token: this.fixture.signedUploadToken ?? 'signed-upload-token',
            signedUrl:
              this.fixture.signedUploadUrl ??
              `https://storage.test/object/upload/sign/${path}?token=signed-upload-token`,
          },
          error: null,
        }
      },
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

function buildPrepareRequestBody(
  overrides?: Partial<Record<'fileName' | 'fileType' | 'fileSize', unknown>>,
) {
  return {
    action: 'prepare',
    fileName: 'new-file.rbx',
    fileType: 'application/octet-stream',
    fileSize: 1024,
    ...overrides,
  }
}

function buildEnqueueRequestBody(overrides?: {
  path?: string
  fileName?: string
  fileType?: string | null
  fileSize?: number
  uploadTicket?: string
  ticketUserId?: string
}) {
  const path = overrides?.path ?? 'user-1/imports/new-file.rbx'
  const fileName = overrides?.fileName ?? 'new-file.rbx'
  const fileType = overrides?.fileType ?? 'application/octet-stream'
  const fileSize = overrides?.fileSize ?? 1024

  return {
    action: 'enqueue',
    path,
    fileName,
    fileType,
    fileSize,
    uploadTicket:
      overrides?.uploadTicket ??
      createImportUploadTicket({
        userId: overrides?.ticketUserId ?? 'user-1',
        path,
        fileName,
        fileType,
        fileSize,
        expiresAt: Date.now() + 5 * 60 * 1000,
      }),
  }
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
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'
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
      buildRequest(
        buildPrepareRequestBody({
          fileName: 'new-file.zip',
          fileType: 'application/zip',
        }),
      ) as never,
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

    const response = await POST(buildRequest(buildPrepareRequestBody()) as never)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
  })

  it('returns 413 when the upload contract request exceeds the size limit', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
    })

    const response = await POST(
      buildRequest(
        buildPrepareRequestBody({
          fileSize: MAX_IMPORT_UPLOAD_BYTES + 1,
        }),
      ) as never,
    )
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toContain('exceeds the 100MB server limit')
    expect(supabase.signedUploadRequests).toEqual([])
    expect(supabase.removedPaths).toEqual([])
  })

  it('returns 500 when active job inspection fails during contract issuance', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      activeJobsError: { message: 'db down', code: 'XX001' },
    })

    const response = await POST(buildRequest(buildPrepareRequestBody()) as never)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to inspect active imports' })
    expect(supabase.removedPaths).toEqual([])
  })

  it('returns 409 when the user already has an active import before upload', async () => {
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

    const response = await POST(buildRequest(buildPrepareRequestBody()) as never)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({
      error: ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE,
      existingJobId: 'import-1',
    })
    expect(supabase.signedUploadRequests).toEqual([])
    expect(supabase.removedPaths).toEqual([])
  })

  it('returns 500 when signed upload contract creation fails', async () => {
    createSupabaseMock({
      user: { id: 'user-1' },
      signedUploadError: { message: 'storage unavailable' },
    })

    const response = await POST(buildRequest(buildPrepareRequestBody()) as never)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to prepare upload' })
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][storage] Failed to create signed upload contract:',
      { message: 'storage unavailable' },
    )
  })

  it('issues a signed upload contract for an authenticated user', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      signedUploadUrl: 'https://storage.test/upload?token=signed-upload-token',
      signedUploadToken: 'signed-upload-token',
    })

    const response = await POST(buildRequest(buildPrepareRequestBody()) as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      path: expect.stringMatching(/^user-1\/imports\/.+new-file\.rbx$/),
      signedUrl: 'https://storage.test/upload?token=signed-upload-token',
      token: 'signed-upload-token',
      uploadTicket: expect.any(String),
    })
    expect(supabase.signedUploadRequests).toEqual([
      {
        bucket: IMPORT_UPLOAD_BUCKET,
        path: expect.stringMatching(/^user-1\/imports\/.+new-file\.rbx$/),
        upsert: false,
      },
    ])
  })

  it('returns 403 when the enqueue path is outside the staged import scope', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
    })

    const response = await POST(
      buildRequest(
        buildEnqueueRequestBody({
          path: 'other-user/imports/new-file.rbx',
        }),
      ) as never,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Access denied' })
    expect(supabase.removedPaths).toEqual([])
  })

  it('returns 403 when the enqueue path stays in the user scope but outside /imports/', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
    })

    const response = await POST(
      buildRequest(
        buildEnqueueRequestBody({
          path: 'user-1/character-assets/existing.png',
        }),
      ) as never,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Access denied' })
    expect(supabase.removedPaths).toEqual([])
  })

  it('returns 403 when the enqueue upload ticket is invalid', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
    })

    const response = await POST(
      buildRequest(
        buildEnqueueRequestBody({
          uploadTicket: 'bad-ticket',
        }),
      ) as never,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Invalid upload reference' })
    expect(supabase.removedPaths).toEqual([])
  })

  it('returns 403 and cleans up the staged upload when the upload ticket is expired', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
    })

    const response = await POST(
      buildRequest(
        buildEnqueueRequestBody({
          uploadTicket: createImportUploadTicket({
            userId: 'user-1',
            path: 'user-1/imports/new-file.rbx',
            fileName: 'new-file.rbx',
            fileType: 'application/octet-stream',
            fileSize: 1024,
            expiresAt: Date.now() - 1_000,
          })!,
        }),
      ) as never,
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Invalid upload reference' })
    expect(supabase.removedPaths).toEqual(['user-1/imports/new-file.rbx'])
  })

  it('returns 413 and cleans up the staged upload when the enqueue payload is oversized', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
    })

    const response = await POST(
      buildRequest(
        buildEnqueueRequestBody({
          fileSize: MAX_IMPORT_UPLOAD_BYTES + 1,
        }),
      ) as never,
    )
    const body = await response.json()

    expect(response.status).toBe(413)
    expect(body.error).toContain('exceeds the 100MB server limit')
    expect(supabase.removedBuckets).toEqual([IMPORT_UPLOAD_BUCKET])
    expect(supabase.removedPaths).toEqual(['user-1/imports/new-file.rbx'])
  })

  it('returns 409 and deletes the staged upload when the user already has an active import at enqueue time', async () => {
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

    const response = await POST(buildRequest(buildEnqueueRequestBody()) as never)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body).toMatchObject({
      error: ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE,
      existingJobId: 'import-1',
    })
    expect(supabase.removedPaths).toEqual(['user-1/imports/new-file.rbx'])
  })

  it('returns 409 on unique-violation enqueue conflicts and cleans up the staged upload', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      insertJobError: { message: 'duplicate key', code: '23505' },
    })

    const response = await POST(buildRequest(buildEnqueueRequestBody()) as never)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE })
    expect(supabase.removedPaths).toEqual(['user-1/imports/new-file.rbx'])
  })

  it('returns 500 on generic enqueue failures and cleans up the staged upload', async () => {
    const supabase = createSupabaseMock({
      user: { id: 'user-1' },
      insertJobError: { message: 'insert failed', code: 'XX002' },
    })

    const response = await POST(buildRequest(buildEnqueueRequestBody()) as never)

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

    const response = await POST(buildRequest(buildEnqueueRequestBody()) as never)
    const body = await response.json()
    await runQueuedBackgroundTask()

    expect(response.status).toBe(200)
    expect(body).toEqual({ jobId: 'job-123', status: 'pending' })
    expect(supabase.insertPayloads).toEqual([
      {
        user_id: 'user-1',
        storage_path: 'user-1/imports/new-file.rbx',
        original_filename: 'new-file.rbx',
        file_type: 'application/octet-stream',
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

    const response = await POST(buildRequest(buildEnqueueRequestBody()) as never)
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

    const response = await POST(buildRequest(buildEnqueueRequestBody()) as never)
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

    const response = await POST(buildRequest(buildEnqueueRequestBody()) as never)
    await runQueuedBackgroundTask()

    expect(response.status).toBe(200)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][storage] Runner trigger error:',
      expect.any(Error),
    )
  })
})
