import { describe, expect, it, vi } from 'vitest'
import { createSupabaseMock, type SupabaseClientType } from '@/tests/mocks/supabase'
import type { Database } from '@/types/database.types'
import { claimPendingJob, pruneHistoricalChatJobs } from './job-queue'

type ChatGenerationJobRow = Database['public']['Tables']['chat_generation_jobs']['Row']

function buildChatJobRow(
  overrides: Partial<ChatGenerationJobRow> &
    Pick<ChatGenerationJobRow, 'id' | 'status' | 'created_at'>,
): ChatGenerationJobRow {
  return {
    id: overrides.id,
    chat_id: overrides.chat_id ?? 'chat-1',
    created_at: overrides.created_at,
    delivery_mode: overrides.delivery_mode ?? 'standard',
    error: overrides.error ?? null,
    external_provider_job_id: overrides.external_provider_job_id ?? null,
    external_provider_last_checked_at: overrides.external_provider_last_checked_at ?? null,
    external_provider_metadata: overrides.external_provider_metadata ?? null,
    external_provider_result_url: overrides.external_provider_result_url ?? null,
    external_provider_status: overrides.external_provider_status ?? null,
    external_provider_submitted_at: overrides.external_provider_submitted_at ?? null,
    failure_stage: overrides.failure_stage ?? null,
    lifecycle_stage: overrides.lifecycle_stage ?? 'queued',
    payload: overrides.payload ?? { request: overrides.id },
    status: overrides.status,
    updated_at: overrides.updated_at ?? overrides.created_at,
    user_id: overrides.user_id ?? 'user-1',
  }
}

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

describe('pruneHistoricalChatJobs', () => {
  it('prunes expired success and error jobs while leaving active and recent rows intact', async () => {
    const now = Date.UTC(2026, 3, 14, 12, 0, 0)
    const rows: ChatGenerationJobRow[] = [
      buildChatJobRow({
        id: 'success-old',
        status: 'success',
        created_at: '2026-04-04T00:00:00.000Z',
      }),
      buildChatJobRow({
        id: 'success-recent',
        status: 'success',
        created_at: '2026-04-12T00:00:00.000Z',
      }),
      buildChatJobRow({
        id: 'error-old',
        status: 'error',
        created_at: '2026-03-20T00:00:00.000Z',
        error: 'boom',
      }),
      buildChatJobRow({
        id: 'error-recent',
        status: 'error',
        created_at: '2026-04-12T00:00:00.000Z',
        error: 'recent boom',
      }),
      buildChatJobRow({
        id: 'processing-active',
        status: 'processing',
        created_at: '2026-04-01T00:00:00.000Z',
      }),
      buildChatJobRow({
        id: 'pending-active',
        status: 'pending',
        created_at: '2026-04-01T00:00:00.000Z',
      }),
    ]
    const supabase = createSupabaseMock({
      tables: {
        chat_generation_jobs: {
          rows,
          primaryKeys: ['id'],
        },
      },
    }) as unknown as SupabaseClientType

    const result = await pruneHistoricalChatJobs(supabase, {
      now,
      successRetentionMs: 7 * 24 * 60 * 60 * 1000,
      errorRetentionMs: 14 * 24 * 60 * 60 * 1000,
      batchSize: 50,
    })

    expect(result).toEqual({
      successPruned: 1,
      errorPruned: 1,
    })
    const remainingJobs = (
      supabase as unknown as { state: { chatGenerationJobs: ChatGenerationJobRow[] } }
    ).state.chatGenerationJobs.map((job) => job.id)
    expect(remainingJobs).toEqual([
      'success-recent',
      'error-recent',
      'processing-active',
      'pending-active',
    ])
  })

  it('caps each status prune by batch size', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const now = Date.UTC(2026, 3, 14, 12, 0, 0)
    const rows: ChatGenerationJobRow[] = [
      buildChatJobRow({
        id: 'success-old-1',
        status: 'success',
        created_at: '2026-04-01T00:00:00.000Z',
      }),
      buildChatJobRow({
        id: 'success-old-2',
        status: 'success',
        created_at: '2026-04-02T00:00:00.000Z',
      }),
      buildChatJobRow({
        id: 'success-old-3',
        status: 'success',
        created_at: '2026-04-03T00:00:00.000Z',
      }),
      buildChatJobRow({
        id: 'error-old-1',
        status: 'error',
        created_at: '2026-03-01T00:00:00.000Z',
        error: 'boom-1',
      }),
      buildChatJobRow({
        id: 'error-old-2',
        status: 'error',
        created_at: '2026-03-02T00:00:00.000Z',
        error: 'boom-2',
      }),
    ]
    const supabase = createSupabaseMock({
      tables: {
        chat_generation_jobs: {
          rows,
          primaryKeys: ['id'],
        },
      },
    }) as unknown as SupabaseClientType

    const result = await pruneHistoricalChatJobs(supabase, {
      now,
      successRetentionMs: 7 * 24 * 60 * 60 * 1000,
      errorRetentionMs: 14 * 24 * 60 * 60 * 1000,
      batchSize: 2,
    })

    expect(result).toEqual({
      successPruned: 2,
      errorPruned: 2,
    })
    const remainingJobs = (
      supabase as unknown as { state: { chatGenerationJobs: ChatGenerationJobRow[] } }
    ).state.chatGenerationJobs.map((job) => job.id)
    expect(remainingJobs).toEqual(['success-old-3'])
    expect(consoleWarnSpy).toHaveBeenCalled()
  })
})
