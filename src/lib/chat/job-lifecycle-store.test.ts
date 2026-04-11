import { beforeEach, describe, expect, it, vi } from 'vitest'

const persistServiceHealthRecordMock = vi.fn()

vi.mock('@/lib/monitoring/service-health-store', () => ({
  persistServiceHealthRecord: (...args: Parameters<typeof persistServiceHealthRecordMock>) =>
    persistServiceHealthRecordMock(...args),
}))

describe('persistChatJobLifecycleStage', () => {
  beforeEach(() => {
    persistServiceHealthRecordMock.mockReset()
  })

  it('records a durable success signal when stage persistence succeeds', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    }))
    const supabase = {
      from: vi.fn(() => ({ update })),
    }

    const {
      getChatJobLifecyclePersistenceStats,
      persistChatJobLifecycleStage,
      __resetChatJobLifecyclePersistenceStatsForTest,
    } = await import('./job-lifecycle-store')

    __resetChatJobLifecyclePersistenceStatsForTest()

    await persistChatJobLifecycleStage({
      supabase: supabase as never,
      jobId: 'job-1',
      stage: 'dispatching_runner_trigger',
    })

    expect(getChatJobLifecyclePersistenceStats()).toMatchObject({
      totalSuccesses: 1,
      consecutiveFailures: 0,
      lastMetadata: {
        jobId: 'job-1',
        stage: 'dispatching_runner_trigger',
      },
    })
    expect(persistServiceHealthRecordMock).toHaveBeenCalledWith({
      label: 'chat-job-lifecycle-persistence',
      wasSuccess: true,
      errorMessage: null,
      metadata: {
        jobId: 'job-1',
        stage: 'dispatching_runner_trigger',
      },
    })
  })

  it('records a durable failure signal when stage persistence fails', async () => {
    const update = vi.fn(() => ({
      eq: vi.fn(async () => ({ error: { message: 'write failed' } })),
    }))
    const supabase = {
      from: vi.fn(() => ({ update })),
    }

    const {
      getChatJobLifecyclePersistenceStats,
      persistChatJobLifecycleStage,
      __resetChatJobLifecyclePersistenceStatsForTest,
    } = await import('./job-lifecycle-store')

    __resetChatJobLifecyclePersistenceStatsForTest()

    await persistChatJobLifecycleStage({
      supabase: supabase as never,
      jobId: 'job-1',
      stage: 'dispatching_runner_trigger',
      additionalUpdate: {
        failure_stage: 'dispatching_runner_trigger',
      },
    })

    expect(getChatJobLifecyclePersistenceStats()).toMatchObject({
      totalFailures: 1,
      consecutiveFailures: 1,
      lastErrorMessage: 'write failed',
      lastMetadata: {
        jobId: 'job-1',
        stage: 'dispatching_runner_trigger',
        hasAdditionalUpdate: true,
      },
    })
    expect(persistServiceHealthRecordMock).toHaveBeenCalledWith({
      label: 'chat-job-lifecycle-persistence',
      wasSuccess: false,
      errorMessage: 'write failed',
      metadata: {
        jobId: 'job-1',
        stage: 'dispatching_runner_trigger',
        hasAdditionalUpdate: true,
      },
    })
  })
})
