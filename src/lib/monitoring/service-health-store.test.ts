import { beforeEach, describe, expect, it, vi } from 'vitest'

const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }

  Object.assign(process.env, ORIGINAL_ENV)
}

describe('service health store', () => {
  beforeEach(() => {
    restoreEnv()
    createAdminClientMock.mockReset()
  })

  it('skips durable writes when admin env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const { persistServiceHealthRecord } = await import('./service-health-store')

    await expect(
      persistServiceHealthRecord({
        label: 'summary-generation',
        wasSuccess: false,
        errorMessage: 'network down',
        metadata: { attempt: 1 },
      }),
    ).resolves.toBeUndefined()

    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('persists service health records through the database RPC when admin env exists', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    createAdminClientMock.mockReturnValue({ rpc })

    const { persistServiceHealthRecord } = await import('./service-health-store')

    await persistServiceHealthRecord({
      label: 'summary-generation',
      wasSuccess: true,
      errorMessage: null,
      metadata: { attempt: 1, status: 202 },
    })

    expect(rpc).toHaveBeenCalledWith('record_service_health_status', {
      p_service_label: 'summary-generation',
      p_was_success: true,
      p_error_message: undefined,
      p_metadata: { attempt: 1, status: 202 },
    })
  })

  it('returns null durable stats when admin env is missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY

    const { loadDurableServiceHealthStats } = await import('./service-health-store')

    await expect(loadDurableServiceHealthStats()).resolves.toBeNull()
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })

  it('maps persisted rows back into trigger stats', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'

    const select = vi.fn(() => ({
      in: vi.fn(async () => ({
        data: [
          {
            service_label: 'summary-generation',
            total_successes: 3,
            total_failures: 1,
            consecutive_failures: 0,
            last_success_at: '2026-04-11T12:00:00.000Z',
            last_failure_at: '2026-04-11T11:00:00.000Z',
            last_error_message: null,
            last_metadata: { attempt: 1, status: 202 },
          },
        ],
        error: null,
      })),
    }))

    createAdminClientMock.mockReturnValue({
      from: vi.fn(() => ({ select })),
    })

    const { loadDurableServiceHealthStats } = await import('./service-health-store')

    const stats = await loadDurableServiceHealthStats()

    expect(stats?.get('summary-generation')).toEqual({
      label: 'summary-generation',
      totalSuccesses: 3,
      totalFailures: 1,
      consecutiveFailures: 0,
      lastSuccessAt: '2026-04-11T12:00:00.000Z',
      lastFailureAt: '2026-04-11T11:00:00.000Z',
      lastErrorMessage: null,
      lastMetadata: { attempt: 1, status: 202 },
    })
  })
})
