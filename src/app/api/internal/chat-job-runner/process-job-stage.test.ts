import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'

const parseChatJobPayloadMock = vi.fn()

vi.mock('@/lib/chat/job-payload', () => ({
  parseChatJobPayload: (...args: unknown[]) => parseChatJobPayloadMock(...args),
}))

type RecordedFilter = {
  field: string
  value: unknown
}

type MockError = {
  message: string
  code?: string | null
}

function matchesFilters(filters: RecordedFilter[], expected: RecordedFilter[]) {
  return expected.every(({ field, value }) =>
    filters.some((filter) => filter.field === field && filter.value === value),
  )
}

function wrapMutationBuilder(
  builder: {
    eq: (field: string, value: unknown) => unknown
    then: (...args: unknown[]) => Promise<unknown>
  },
  shouldFail: (filters: RecordedFilter[]) => boolean,
  error: MockError,
) {
  const filters: RecordedFilter[] = []

  const wrapped = {
    eq(field: string, value: unknown) {
      filters.push({ field, value })
      builder.eq(field, value)
      return wrapped
    },
    then<TResult1 = { error: null }, TResult2 = never>(
      onfulfilled?:
        | ((value: { error: MockError | null }) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      if (shouldFail(filters)) {
        return Promise.resolve({ error }).then(onfulfilled, onrejected)
      }

      return builder.then(onfulfilled, onrejected)
    },
  }

  return wrapped
}

function withFromOverride<T extends { from: (table: string) => unknown }>(
  supabase: T,
  override: (table: string, handler: Record<string, unknown>) => Record<string, unknown> | null,
): T {
  const originalFrom = supabase.from.bind(supabase)

  ;(supabase as T).from = ((table: string) => {
    const handler = originalFrom(table) as Record<string, unknown>
    return override(table, handler) ?? handler
  }) as T['from']

  return supabase
}

async function loadModule() {
  return await import('./process-job-stage')
}

describe('process-chat-job-stage', () => {
  beforeEach(() => {
    vi.resetModules()
    parseChatJobPayloadMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('marks invalid payloads as terminal errors', async () => {
    parseChatJobPayloadMock.mockReturnValue(null)
    const executeChatJobFn = vi.fn()
    const supabase = createChatJobRunnerSupabaseMock()

    const { processChatJobStage } = await loadModule()
    const result = await processChatJobStage({
      supabase: supabase as never,
      jobId: 'job-invalid',
      rawPayload: { bad: true },
      origin: 'https://internal.example.com',
      executeChatJobFn,
    })

    expect(result).toEqual({
      jobId: 'job-invalid',
      status: 'error',
      error: 'Invalid job payload',
    })
    expect(executeChatJobFn).not.toHaveBeenCalled()
    expect(supabase.updates).toContainEqual({
      status: 'error',
      error: 'Invalid job payload',
      lifecycle_stage: 'invalid_payload',
      failure_stage: 'invalid_payload',
    })
  })

  it('returns processing jobs without persisting a terminal status', async () => {
    parseChatJobPayloadMock.mockReturnValue({ requestId: 'req-processing' })
    const executeChatJobFn = vi.fn(async () => ({ status: 'processing' as const }))
    const supabase = createChatJobRunnerSupabaseMock()

    const { processChatJobStage } = await loadModule()
    const result = await processChatJobStage({
      supabase: supabase as never,
      jobId: 'job-processing',
      rawPayload: { ok: true },
      origin: 'https://internal.example.com',
      executeChatJobFn,
    })

    expect(result).toEqual({
      jobId: 'job-processing',
      status: 'processing',
    })
    expect(supabase.updates).toEqual([])
  })

  it('persists completed jobs as success after execution', async () => {
    const payload = { requestId: 'req-success' }
    parseChatJobPayloadMock.mockReturnValue(payload)
    const executeChatJobFn = vi.fn(async () => ({ status: 'success' as const }))
    const supabase = createChatJobRunnerSupabaseMock()

    const { processChatJobStage } = await loadModule()
    const result = await processChatJobStage({
      supabase: supabase as never,
      jobId: 'job-success',
      rawPayload: { ok: true },
      origin: 'https://internal.example.com',
      executeChatJobFn,
    })

    expect(result).toEqual({
      jobId: 'job-success',
      status: 'success',
    })
    expect(executeChatJobFn).toHaveBeenCalledWith({
      supabase,
      jobId: 'job-success',
      payload,
      origin: 'https://internal.example.com',
    })
    expect(supabase.updates).toContainEqual({
      status: 'success',
      error: null,
      lifecycle_stage: 'completed',
      failure_stage: null,
    })
  })

  it('persists execution failures using the reported lifecycle stage', async () => {
    parseChatJobPayloadMock.mockReturnValue({ requestId: 'req-failure' })
    const { ChatJobExecutionError } = await import('./runner-errors')
    const executeChatJobFn = vi.fn(async () => {
      throw new ChatJobExecutionError('stream exploded', 'provider_stream_error')
    })
    const supabase = createChatJobRunnerSupabaseMock()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const { processChatJobStage } = await loadModule()
      const result = await processChatJobStage({
        supabase: supabase as never,
        jobId: 'job-failure',
        rawPayload: { ok: true },
        origin: 'https://internal.example.com',
        executeChatJobFn,
      })

      expect(result).toEqual({
        jobId: 'job-failure',
        status: 'error',
        error: 'stream exploded',
      })
      expect(supabase.updates).toContainEqual({
        status: 'error',
        error: 'stream exploded',
        lifecycle_stage: 'provider_stream_error',
        failure_stage: 'provider_stream_error',
      })
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('surfaces terminal success persistence failures after retrying', async () => {
    let attempts = 0
    parseChatJobPayloadMock.mockReturnValue({ requestId: 'req-retry' })
    const executeChatJobFn = vi.fn(async () => ({ status: 'success' as const }))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const supabase = withFromOverride(createChatJobRunnerSupabaseMock(), (table, handler) => {
      if (table !== 'chat_generation_jobs') {
        return null
      }

      return {
        ...handler,
        update: (payload: Record<string, unknown>) => {
          const baseBuilder = (
            handler.update as (payload: Record<string, unknown>) => {
              eq: (field: string, value: unknown) => unknown
              then: (...args: unknown[]) => Promise<unknown>
            }
          )(payload)

          if (payload.status !== 'success') {
            return baseBuilder
          }

          return wrapMutationBuilder(
            baseBuilder,
            (filters) => {
              if (matchesFilters(filters, [{ field: 'id', value: 'job-retry' }])) {
                attempts += 1
                return true
              }

              return false
            },
            { message: 'job update failed', code: '40001' },
          )
        },
      }
    })

    try {
      const { processChatJobStage } = await loadModule()
      const result = await processChatJobStage({
        supabase: supabase as never,
        jobId: 'job-retry',
        rawPayload: { ok: true },
        origin: 'https://internal.example.com',
        executeChatJobFn,
      })

      expect(result).toEqual({
        jobId: 'job-retry',
        status: 'error',
        error: 'Failed to persist chat job success status after 3 attempts: job update failed',
      })
      expect(attempts).toBe(3)
    } finally {
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})
