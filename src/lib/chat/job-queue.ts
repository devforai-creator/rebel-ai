import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.types'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH } from './delivery-mode'

export type RawChatJobRecord = { id: string; payload: unknown }
type ChatJobQueueSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from'>
type ChatGenerationJobRow = Database['public']['Tables']['chat_generation_jobs']['Row']
type ChatGenerationJobUpdate = Database['public']['Tables']['chat_generation_jobs']['Update']
type PendingJobRow = Pick<ChatGenerationJobRow, 'id' | 'payload' | 'status'>
type StuckJobRow = Pick<ChatGenerationJobRow, 'id' | 'chat_id' | 'created_at' | 'delivery_mode'>

const FALLBACK_TIMEOUT_MS = 10 * 60 * 1000

export const PROCESSING_JOB_TIMEOUT_MS = Number(
  process.env.CHAT_JOB_PROCESSING_TIMEOUT_MS ?? FALLBACK_TIMEOUT_MS,
)

export async function claimPendingJob(
  supabase: ChatJobQueueSupabaseClient,
): Promise<RawChatJobRecord | null> {
  const { data: nextJob, error } = await supabase
    .from('chat_generation_jobs')
    .select<'id, payload, status'>('id, payload, status')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<PendingJobRow>()

  if (error) {
    console.error('[Chat Job Queue] Failed to fetch pending job', error)
    return null
  }

  if (!nextJob) {
    return null
  }

  const claimUpdate: ChatGenerationJobUpdate = { status: 'processing' }
  const { data: claimedJob, error: claimError } = await supabase
    .from('chat_generation_jobs')
    .update(claimUpdate as never)
    .eq('id', nextJob.id)
    .eq('status', 'pending')
    .select('id, payload')
    .single<RawChatJobRecord>()

  if (claimError || !claimedJob) {
    console.warn('[Chat Job Queue] Failed to claim pending job', {
      jobId: nextJob.id,
      error: claimError?.message,
    })
    return null
  }

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
