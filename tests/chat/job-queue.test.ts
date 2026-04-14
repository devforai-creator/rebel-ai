import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import {
  claimPendingJob,
  resetStuckProcessingJobs,
  PROCESSING_JOB_TIMEOUT_MS,
} from '@/lib/chat/job-queue'
import type { SupabaseClient } from '@supabase/supabase-js'

type QueryBuilder = {
  select: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  neq: ReturnType<typeof vi.fn>
  lt: ReturnType<typeof vi.fn>
  gte: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  order: ReturnType<typeof vi.fn>
  limit: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  single: ReturnType<typeof vi.fn>
}

type RpcCapableSupabaseClient = SupabaseClient & {
  rpc: ReturnType<typeof vi.fn>
}

function createQueryBuilder(): QueryBuilder {
  const builder: Partial<QueryBuilder> = {}

  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.neq = vi.fn(() => builder)
  builder.order = vi.fn(() => builder)
  builder.limit = vi.fn(() => builder)
  builder.update = vi.fn(() => builder)
  builder.delete = vi.fn(() => builder)
  builder.lt = vi.fn(() => builder)
  builder.gte = vi.fn(() => builder)
  builder.in = vi.fn(() => builder)
  builder.maybeSingle = vi.fn()
  builder.single = vi.fn()

  return builder as QueryBuilder
}

function createSupabaseClientMock(builders: QueryBuilder[], rpcResults?: Record<string, unknown>) {
  const queue = [...builders]
  const fromMock = vi.fn(() => {
    const next = queue.shift()
    if (!next) {
      throw new Error('No mock builder available for from() call')
    }
    return next
  })
  const rpcMock = vi.fn(async (name: string) => {
    if (!rpcResults || !(name in rpcResults)) {
      throw new Error(`No mock RPC result available for rpc(${name})`)
    }
    return { data: rpcResults[name], error: null }
  })

  return {
    client: { from: fromMock, rpc: rpcMock } as unknown as RpcCapableSupabaseClient,
    fromMock,
    rpcMock,
  }
}

function setupWarnSpy() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {})
}

function setupErrorSpy() {
  return vi.spyOn(console, 'error').mockImplementation(() => {})
}

let warnSpy: ReturnType<typeof setupWarnSpy>
let errorSpy: ReturnType<typeof setupErrorSpy>

beforeEach(() => {
  warnSpy = setupWarnSpy()
  errorSpy = setupErrorSpy()
})

afterEach(() => {
  warnSpy.mockRestore()
  errorSpy.mockRestore()
})

describe('claimPendingJob', () => {
  it('claims the oldest pending job through the atomic RPC', async () => {
    const claimedJob = { id: 'job-1', payload: { foo: 'bar' } }

    const { client, rpcMock, fromMock } = createSupabaseClientMock([], {
      claim_pending_chat_job: [claimedJob],
    })

    const job = await claimPendingJob(client)

    expect(job).toEqual(claimedJob)
    expect(rpcMock).toHaveBeenCalledWith('claim_pending_chat_job')
    expect(fromMock).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('returns null when the atomic RPC fails', async () => {
    const rpcMock = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('db unavailable'),
    })
    const client = { from: vi.fn(), rpc: rpcMock } as unknown as RpcCapableSupabaseClient

    const job = await claimPendingJob(client)

    expect(job).toBeNull()
    expect(rpcMock).toHaveBeenCalledWith('claim_pending_chat_job')
    expect(errorSpy).toHaveBeenCalledWith(
      '[Chat Job Queue] Failed to claim pending job',
      expect.any(Error),
    )
  })

  it('returns null when the atomic RPC claims no row', async () => {
    const { client, rpcMock } = createSupabaseClientMock([], {
      claim_pending_chat_job: [],
    })

    const job = await claimPendingJob(client)

    expect(job).toBeNull()
    expect(rpcMock).toHaveBeenCalledWith('claim_pending_chat_job')
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('resetStuckProcessingJobs', () => {
  it('marks stuck jobs as error and preserves partial messages', async () => {
    // Builder for: SELECT stuck jobs
    const selectBuilder = createQueryBuilder()
    // Builder for: UPDATE jobs to error
    const updateBuilder = createQueryBuilder()

    const stuckJobs = [
      { id: 'job-1', chat_id: 'chat-1', created_at: '2025-01-01T00:00:00Z' },
      { id: 'job-2', chat_id: 'chat-2', created_at: '2025-01-01T00:01:00Z' },
    ]

    // Mock the select query for stuck jobs
    selectBuilder.lt.mockResolvedValue({ data: stuckJobs, error: null })
    // Mock the update query
    updateBuilder.select.mockResolvedValue({
      data: [{ id: 'job-1' }, { id: 'job-2' }],
      error: null,
    })

    const now = Date.parse('2025-01-01T00:10:00Z')
    const expectedCutoff = new Date(now - PROCESSING_JOB_TIMEOUT_MS).toISOString()

    const { client } = createSupabaseClientMock([selectBuilder, updateBuilder])

    const errorCount = await resetStuckProcessingJobs(client, now)

    expect(errorCount).toBe(2)
    // Verify select query
    expect(selectBuilder.select).toHaveBeenCalledWith('id, chat_id, created_at, delivery_mode')
    expect(selectBuilder.eq).toHaveBeenCalledWith('status', 'processing')
    expect(selectBuilder.neq).toHaveBeenCalledWith('delivery_mode', 'anthropic_batch')
    expect(selectBuilder.lt).toHaveBeenCalledWith('updated_at', expectedCutoff)
    // Verify update query marks as error
    expect(updateBuilder.update).toHaveBeenCalledWith({
      status: 'error',
      error: 'Job timed out after processing for too long',
      lifecycle_stage: 'timed_out',
      failure_stage: 'timed_out',
    })
    expect(updateBuilder.in).toHaveBeenCalledWith('id', ['job-1', 'job-2'])
    // Partial messages are now preserved (not deleted)
    expect(warnSpy).toHaveBeenCalledWith(
      '[Chat Job Queue] Marked stuck jobs as error with cleanup',
      {
        cutoffIso: expectedCutoff,
        errorCount: 2,
        cleanedUpChats: ['chat-1', 'chat-2'],
      },
    )
  })

  it('logs and returns zero when Supabase fetch errors', async () => {
    const builder = createQueryBuilder()
    const failure = new Error('permission denied')
    builder.lt.mockResolvedValue({ data: null, error: failure })

    const { client } = createSupabaseClientMock([builder])

    const errorCount = await resetStuckProcessingJobs(client)

    expect(errorCount).toBe(0)
    expect(errorSpy).toHaveBeenCalledWith('[Chat Job Queue] Failed to fetch stuck jobs', failure)
  })

  it('returns zero when no stuck jobs found', async () => {
    const builder = createQueryBuilder()
    builder.lt.mockResolvedValue({ data: [], error: null })

    const { client } = createSupabaseClientMock([builder])

    const errorCount = await resetStuckProcessingJobs(client)

    expect(errorCount).toBe(0)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
