import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.types'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH } from './delivery-mode'
import { CHAT_JOB_LIFECYCLE_STAGE_TIMED_OUT } from './job-lifecycle'
import { CHAT_RUNNER_LIMITS } from './runtime-limits'

export type RawChatJobRecord = { id: string; payload: unknown }
type ChatJobQueueSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from' | 'rpc'>
type ChatGenerationJobRow = Database['public']['Tables']['chat_generation_jobs']['Row']
type ChatGenerationJobUpdate = Database['public']['Tables']['chat_generation_jobs']['Update']
type StuckJobRow = Pick<ChatGenerationJobRow, 'id' | 'chat_id' | 'created_at' | 'delivery_mode'>
type TerminalChatJobRow = Pick<ChatGenerationJobRow, 'id' | 'status' | 'created_at'>

const FALLBACK_TIMEOUT_MS = CHAT_RUNNER_LIMITS.stuckProcessingJobTimeoutMs
const DAY_MS = 24 * 60 * 60 * 1000
const FALLBACK_SUCCESS_RETENTION_DAYS = 7
const FALLBACK_ERROR_RETENTION_DAYS = 14
const FALLBACK_HISTORY_PRUNE_BATCH_SIZE = 500

export type ClaimPendingJobMetrics = {
  fetchDurationMs: number
  updateDurationMs: number
  fetchedPendingRow: boolean
  claimed: boolean
}

export type HistoricalChatJobPruneResult = {
  successPruned: number
  errorPruned: number
}

export const PROCESSING_JOB_TIMEOUT_MS = Number(
  process.env.CHAT_JOB_PROCESSING_TIMEOUT_MS ?? FALLBACK_TIMEOUT_MS,
)
export const CHAT_JOB_SUCCESS_RETENTION_MS =
  Number(process.env.CHAT_JOB_SUCCESS_RETENTION_DAYS ?? FALLBACK_SUCCESS_RETENTION_DAYS) * DAY_MS
export const CHAT_JOB_ERROR_RETENTION_MS =
  Number(process.env.CHAT_JOB_ERROR_RETENTION_DAYS ?? FALLBACK_ERROR_RETENTION_DAYS) * DAY_MS
export const CHAT_JOB_HISTORY_PRUNE_BATCH_SIZE = Math.max(
  1,
  Number(process.env.CHAT_JOB_HISTORY_PRUNE_BATCH_SIZE ?? FALLBACK_HISTORY_PRUNE_BATCH_SIZE),
)

export async function claimPendingJob(
  supabase: ChatJobQueueSupabaseClient,
  options?: {
    onMetrics?: (metrics: ClaimPendingJobMetrics) => void
  },
): Promise<RawChatJobRecord | null> {
  const claimStart = performance.now()
  const { data, error } = await supabase.rpc('claim_pending_chat_job')
  const claimDurationMs = performance.now() - claimStart
  const claimedRows = Array.isArray(data) ? (data as RawChatJobRecord[]) : []
  const claimedJob = claimedRows[0] ?? null

  if (error) {
    options?.onMetrics?.({
      fetchDurationMs: 0,
      updateDurationMs: claimDurationMs,
      fetchedPendingRow: false,
      claimed: false,
    })
    console.error('[Chat Job Queue] Failed to claim pending job', error)
    return null
  }

  if (!claimedJob) {
    options?.onMetrics?.({
      fetchDurationMs: 0,
      updateDurationMs: claimDurationMs,
      fetchedPendingRow: false,
      claimed: false,
    })
    return null
  }

  options?.onMetrics?.({
    fetchDurationMs: 0,
    updateDurationMs: claimDurationMs,
    fetchedPendingRow: true,
    claimed: true,
  })

  return claimedJob
}

export async function resetStuckProcessingJobs(
  supabase: ChatJobQueueSupabaseClient,
  now: number = Date.now(),
): Promise<number> {
  const cutoffIso = new Date(now - PROCESSING_JOB_TIMEOUT_MS).toISOString()

  // 1. Find stuck jobs (need chat_id and created_at for cleanup)
  const { data: stuckJobRows, error: fetchError } = await supabase
    .from('chat_generation_jobs')
    .select<'id, chat_id, created_at, delivery_mode'>('id, chat_id, created_at, delivery_mode')
    .eq('status', 'processing')
    .neq('delivery_mode', CHAT_DELIVERY_MODE_ANTHROPIC_BATCH)
    .lt('updated_at', cutoffIso)

  if (fetchError) {
    console.error('[Chat Job Queue] Failed to fetch stuck jobs', fetchError)
    return 0
  }

  const stuckJobs = (stuckJobRows ?? []) as StuckJobRow[]

  if (stuckJobs.length === 0) {
    return 0
  }

  // 2. Keep partial assistant messages (they may contain useful content)
  // Previously deleted, but 300s of generation is valuable even if incomplete

  // 3. Mark stuck jobs as error (not pending - avoid duplicate processing)
  const jobIds = stuckJobs.map((job) => job.id)
  const timeoutUpdate: ChatGenerationJobUpdate = {
    status: 'error',
    error: 'Job timed out after processing for too long',
    lifecycle_stage: CHAT_JOB_LIFECYCLE_STAGE_TIMED_OUT,
    failure_stage: CHAT_JOB_LIFECYCLE_STAGE_TIMED_OUT,
  }
  const { data, error } = await supabase
    .from('chat_generation_jobs')
    .update(timeoutUpdate as never)
    .in('id', jobIds)
    .select('id')

  if (error) {
    console.error('[Chat Job Queue] Failed to mark stuck jobs as error', error)
    return 0
  }

  const errorCount = Array.isArray(data) ? data.length : 0

  if (errorCount > 0) {
    console.warn('[Chat Job Queue] Marked stuck jobs as error with cleanup', {
      cutoffIso,
      errorCount,
      cleanedUpChats: stuckJobs.map((j) => j.chat_id),
    })
  }

  return errorCount
}

async function pruneHistoricalChatJobsByStatus({
  supabase,
  status,
  cutoffIso,
  batchSize,
}: {
  supabase: ChatJobQueueSupabaseClient
  status: 'success' | 'error'
  cutoffIso: string
  batchSize: number
}): Promise<number> {
  const { data: expiredJobRows, error: fetchError } = await supabase
    .from('chat_generation_jobs')
    .select<'id, status, created_at'>('id, status, created_at')
    .eq('status', status)
    .lt('created_at', cutoffIso)
    .order('created_at', { ascending: true })
    .limit(batchSize)

  if (fetchError) {
    console.error('[Chat Job Queue] Failed to fetch historical jobs for pruning', {
      status,
      cutoffIso,
      error: fetchError,
    })
    return 0
  }

  const expiredJobs = (expiredJobRows ?? []) as TerminalChatJobRow[]
  if (expiredJobs.length === 0) {
    return 0
  }

  const expiredJobIds = expiredJobs.map((job) => job.id)
  const { error: deleteError } = await supabase
    .from('chat_generation_jobs')
    .delete()
    .in('id', expiredJobIds)

  if (deleteError) {
    console.error('[Chat Job Queue] Failed to prune historical jobs', {
      status,
      cutoffIso,
      error: deleteError,
      attemptedCount: expiredJobIds.length,
    })
    return 0
  }

  const prunedCount = expiredJobIds.length
  if (prunedCount > 0) {
    console.warn('[Chat Job Queue] Pruned historical chat jobs', {
      status,
      cutoffIso,
      prunedCount,
      oldestPrunedCreatedAt: expiredJobs[0]?.created_at ?? null,
      newestPrunedCreatedAt: expiredJobs[expiredJobs.length - 1]?.created_at ?? null,
    })
  }

  return prunedCount
}

export async function pruneHistoricalChatJobs(
  supabase: ChatJobQueueSupabaseClient,
  options?: {
    now?: number
    successRetentionMs?: number
    errorRetentionMs?: number
    batchSize?: number
  },
): Promise<HistoricalChatJobPruneResult> {
  const now = options?.now ?? Date.now()
  const successRetentionMs = options?.successRetentionMs ?? CHAT_JOB_SUCCESS_RETENTION_MS
  const errorRetentionMs = options?.errorRetentionMs ?? CHAT_JOB_ERROR_RETENTION_MS
  const batchSize = Math.max(1, options?.batchSize ?? CHAT_JOB_HISTORY_PRUNE_BATCH_SIZE)

  const result: HistoricalChatJobPruneResult = {
    successPruned: 0,
    errorPruned: 0,
  }

  if (Number.isFinite(successRetentionMs) && successRetentionMs > 0) {
    result.successPruned = await pruneHistoricalChatJobsByStatus({
      supabase,
      status: 'success',
      cutoffIso: new Date(now - successRetentionMs).toISOString(),
      batchSize,
    })
  }

  if (Number.isFinite(errorRetentionMs) && errorRetentionMs > 0) {
    result.errorPruned = await pruneHistoricalChatJobsByStatus({
      supabase,
      status: 'error',
      cutoffIso: new Date(now - errorRetentionMs).toISOString(),
      batchSize,
    })
  }

  return result
}
