import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.types'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH } from './delivery-mode'
import { CHAT_JOB_LIFECYCLE_STAGE_TIMED_OUT } from './job-lifecycle'

export type RawChatJobRecord = { id: string; payload: unknown }
type ChatJobQueueSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from' | 'rpc'>
type ChatGenerationJobRow = Database['public']['Tables']['chat_generation_jobs']['Row']
type ChatGenerationJobUpdate = Database['public']['Tables']['chat_generation_jobs']['Update']
type StuckJobRow = Pick<ChatGenerationJobRow, 'id' | 'chat_id' | 'created_at' | 'delivery_mode'>

const FALLBACK_TIMEOUT_MS = 10 * 60 * 1000

export type ClaimPendingJobMetrics = {
  fetchDurationMs: number
  updateDurationMs: number
  fetchedPendingRow: boolean
  claimed: boolean
}

export const PROCESSING_JOB_TIMEOUT_MS = Number(
  process.env.CHAT_JOB_PROCESSING_TIMEOUT_MS ?? FALLBACK_TIMEOUT_MS,
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
