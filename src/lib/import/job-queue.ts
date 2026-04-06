import type { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.types'

const FALLBACK_IMPORT_TIMEOUT_MS = 15 * 60 * 1000
type ImportJobQueueSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from'>
type ImportJobUpdate = Database['public']['Tables']['charx_import_jobs']['Update']
type ImportJobIdRow = Pick<Database['public']['Tables']['charx_import_jobs']['Row'], 'id'>

export const IMPORT_JOB_PROCESSING_TIMEOUT_MS = Number(
  process.env.CHARACTER_IMPORT_JOB_PROCESSING_TIMEOUT_MS ?? FALLBACK_IMPORT_TIMEOUT_MS,
)

export async function resetStuckImportProcessingJobs(
  supabase: ImportJobQueueSupabaseClient,
  now: number = Date.now(),
): Promise<number> {
  const cutoffIso = new Date(now - IMPORT_JOB_PROCESSING_TIMEOUT_MS).toISOString()

  const timeoutUpdate: ImportJobUpdate = {
    status: 'error',
    error_message: 'Processing timed out – automatically marked as error by janitor',
    completed_at: new Date(now).toISOString(),
  }

  const { data, error } = await supabase
    .from('charx_import_jobs')
    .update(timeoutUpdate as never)
    .eq('status', 'processing')
    .lt('updated_at', cutoffIso)
    .select('id')

  if (error) {
    console.error('[Import Job Queue] Failed to recover stuck jobs', {
      errorMessage: error.message,
      errorCode: error.code,
      cutoffTime: cutoffIso,
    })
    return 0
  }

  const recoveredJobs = (data ?? []) as ImportJobIdRow[]
  const recoveredCount = recoveredJobs.length

  if (recoveredCount > 0) {
    console.warn('[Import Job Queue] Recovered stuck import jobs', {
      cutoffIso,
      recoveredJobIds: recoveredJobs.map((job) => job.id),
    })
  }

  return recoveredCount
}
