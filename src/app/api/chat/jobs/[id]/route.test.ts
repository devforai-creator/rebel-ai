import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

type SupabaseUser = { id: string } | null
type JobRow = {
  id: string
  chat_id: string
  status: string
  error: string | null
  delivery_mode: string | null
  lifecycle_stage: string
  failure_stage: string | null
  created_at: string
  updated_at: string
}

let supabaseMock: ReturnType<typeof createSupabaseMock>
const pollAnthropicBatchJobForUserMock = vi.fn()

const createClientMock = vi.fn(async () => supabaseMock)

vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server')
  return {
    ...actual,
    after: vi.fn((cb: () => void | Promise<void>) => {
      cb()
    }),
  }
})

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => createClientMock(),
}))

vi.mock('@/lib/internal-api-origin', () => ({
  resolveInternalApiOrigin: vi.fn(() => 'https://internal.example.com'),
}))

vi.mock('@/app/api/internal/chat-job-runner/service', () => ({
  pollAnthropicBatchJobForUser: (...args: unknown[]) => pollAnthropicBatchJobForUserMock(...args),
}))

function createSupabaseMock(user: SupabaseUser, job: JobRow | null) {
  const eqCalls: Array<[string, unknown]> = []

  return {
    eqCalls,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from(table: string) {
      if (table !== 'chat_generation_jobs') {
        throw new Error(`Unexpected table ${table}`)
      }

      return {
        select: () => this.from(table),
        eq: (field: string, value: unknown) => {
          eqCalls.push([field, value])
          return this.from(table)
        },
        single: async () => ({
          data: job,
          error: job ? null : { message: 'Not found' },
        }),
      }
    },
  }
}

function buildContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('GET /api/chat/jobs/[id]', () => {
  beforeEach(() => {
    vi.resetModules()
    createClientMock.mockClear()
    pollAnthropicBatchJobForUserMock.mockReset()
    pollAnthropicBatchJobForUserMock.mockResolvedValue(null)
  })

  it('returns 401 when user is not authenticated', async () => {
    supabaseMock = createSupabaseMock(null, null)
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/chat/jobs/job-1'),
      buildContext('job-1'),
    )

    expect(response.status).toBe(401)
  }, 10_000)

  it('returns 404 when job is missing or not owned', async () => {
    supabaseMock = createSupabaseMock({ id: 'user-1' }, null)
    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/chat/jobs/job-2'),
      buildContext('job-2'),
    )

    expect(response.status).toBe(404)
  })

  it('returns job details for owner', async () => {
    const jobRow: JobRow = {
      id: 'job-3',
      chat_id: 'chat-1',
      status: 'pending',
      error: null,
      delivery_mode: 'streaming',
      lifecycle_stage: 'queued',
      failure_stage: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    supabaseMock = createSupabaseMock({ id: 'user-1' }, jobRow)

    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/chat/jobs/job-3'),
      buildContext('job-3'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      id: 'job-3',
      chatId: 'chat-1',
      status: 'pending',
      error: null,
      deliveryMode: 'streaming',
      lifecycleStage: 'queued',
      failureStage: null,
    })
    expect(supabaseMock.eqCalls).toContainEqual(['id', 'job-3'])
    expect(supabaseMock.eqCalls).toContainEqual(['user_id', 'user-1'])
  })

  it('schedules an Anthropic batch poll after returning current job status', async () => {
    const jobRow: JobRow = {
      id: 'job-4',
      chat_id: 'chat-9',
      status: 'processing',
      error: null,
      delivery_mode: 'anthropic_batch',
      lifecycle_stage: 'waiting_provider_batch',
      failure_stage: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    }
    supabaseMock = createSupabaseMock({ id: 'user-1' }, jobRow)

    const { GET } = await import('./route')

    const response = await GET(
      new NextRequest('http://localhost/api/chat/jobs/job-4'),
      buildContext('job-4'),
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      id: 'job-4',
      chatId: 'chat-9',
      status: 'processing',
      deliveryMode: 'anthropic_batch',
    })
    expect(pollAnthropicBatchJobForUserMock).toHaveBeenCalledWith({
      jobId: 'job-4',
      userId: 'user-1',
      origin: 'https://internal.example.com',
    })
  })
})
