import { describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import { claimPendingJob } from './job-queue'

describe('claimPendingJob', () => {
  it('claims the next pending job through the atomic RPC', async () => {
    const onMetrics = vi.fn()
    const supabase = createSupabaseMock({
      rpc: {
        claim_pending_chat_job: () => [
          {
            id: 'job-1',
            payload: { ok: true },
          },
        ],
      },
    }) as unknown as SupabaseClientType

    const result = await claimPendingJob(supabase, { onMetrics })

    expect(result).toEqual({
      id: 'job-1',
      payload: { ok: true },
    })
    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchDurationMs: 0,
        updateDurationMs: expect.any(Number),
        fetchedPendingRow: true,
        claimed: true,
      }),
    )
  })

  it('returns null when the atomic RPC finds no pending rows', async () => {
    const onMetrics = vi.fn()
    const supabase = createSupabaseMock({
      rpc: {
        claim_pending_chat_job: () => [],
      },
    }) as unknown as SupabaseClientType

    const result = await claimPendingJob(supabase, { onMetrics })

    expect(result).toBeNull()
    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchDurationMs: 0,
        updateDurationMs: expect.any(Number),
        fetchedPendingRow: false,
        claimed: false,
      }),
    )
  })

  it('returns null and logs when the atomic RPC fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onMetrics = vi.fn()
    const supabase = {
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'rpc failed' },
      }),
      from: vi.fn(),
    } as unknown as SupabaseClientType

    const result = await claimPendingJob(supabase, { onMetrics })

    expect(result).toBeNull()
    expect(onMetrics).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchDurationMs: 0,
        updateDurationMs: expect.any(Number),
        fetchedPendingRow: false,
        claimed: false,
      }),
    )
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Chat Job Queue] Failed to claim pending job',
      expect.objectContaining({ message: 'rpc failed' }),
    )
  })
})
