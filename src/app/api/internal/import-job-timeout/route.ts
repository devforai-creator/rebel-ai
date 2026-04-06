import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.types'

const CHAT_ADMIN_SECRET = process.env.CHAT_ADMIN_SECRET
const IMPORT_JOB_TIMEOUT_DEBUG_ENABLED = process.env.IMPORT_JOB_TIMEOUT_DEBUG === 'true'

function logImportJobTimeoutDebug(...args: unknown[]): void {
  if (IMPORT_JOB_TIMEOUT_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

const RequestSchema = z.object({
  jobId: z.string().uuid(),
  jobType: z.literal('charx'),
  userId: z.string().uuid(),
  errorMessage: z.string().min(1).max(500),
})

type ImportJobRow = Pick<
  Database['public']['Tables']['charx_import_jobs']['Row'],
  'id' | 'user_id' | 'status'
>
type ImportJobUpdate = Database['public']['Tables']['charx_import_jobs']['Update']
type UpdatedImportJobRow = Pick<
  Database['public']['Tables']['charx_import_jobs']['Row'],
  'id' | 'status' | 'error_message' | 'completed_at'
>

export const runtime = 'nodejs'

/**
 * Internal endpoint to mark stale import jobs as timed out.
 * Uses service role to bypass RLS restrictions on import job tables.
 *
 * Security: Protected by CHAT_ADMIN_SECRET bearer token.
 */
export async function POST(request: NextRequest) {
  // Verify admin secret
  const authHeader = request.headers.get('Authorization')
  if (!CHAT_ADMIN_SECRET || authHeader !== `Bearer ${CHAT_ADMIN_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const parsed = RequestSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { jobId, jobType, userId, errorMessage } = parsed.data
  const adminSupabase = createAdminClient()

  const { data: job, error: fetchError } = await adminSupabase
    .from('charx_import_jobs')
    .select<'id, user_id, status'>('id, user_id, status')
    .eq('id', jobId)
    .single<ImportJobRow>()

  if (fetchError || !job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (job.user_id !== userId) {
    console.error('[Import Job Timeout] User mismatch', {
      jobId,
      jobType,
      expectedUserId: userId,
      actualUserId: job.user_id,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  if (job.status !== 'processing') {
    // Job already completed or errored, no action needed
    return NextResponse.json({ updated: false, reason: 'Job not in processing state' })
  }

  const updatePayload = {
    status: 'error' as const,
    completed_at: new Date().toISOString(),
    error_message: errorMessage,
  }
  const typedUpdatePayload: ImportJobUpdate = updatePayload

  // Add status='processing' condition to prevent race condition:
  // If runner completes the job between our read and update, we shouldn't overwrite it
  const { data: updatedJob, error: updateError } = await adminSupabase
    .from('charx_import_jobs')
    .update(typedUpdatePayload as never)
    .eq('id', jobId)
    .eq('status', 'processing')
    .select('id, status, error_message, completed_at')
    .maybeSingle<UpdatedImportJobRow>()

  if (updateError) {
    console.error('[Import Job Timeout] Failed to update job', {
      jobId,
      jobType,
      error: updateError.message,
    })
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 })
  }

  // No rows updated = job status changed between read and update (race condition)
  if (!updatedJob) {
    return NextResponse.json({
      updated: false,
      reason: 'Job status changed (likely completed by runner)',
    })
  }

  logImportJobTimeoutDebug('[Import Job Timeout] Job marked as timed out', {
    jobId,
    jobType,
    userId,
  })

  return NextResponse.json({
    updated: true,
    job: updatedJob,
  })
}
