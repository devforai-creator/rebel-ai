import { NextRequest, NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database } from '@/types/database.types'
import { processCharacterImportJob } from '@/lib/character-import-jobs'
import { requireBearerToken } from '@/lib/http/api-contract'

export const runtime = 'nodejs'
export const maxDuration = 300

type RunnerRequest = {
  limit?: number
  jobId?: string
  dispatch?: boolean
}

type JobRow = {
  id: string
  user_id: string
  storage_path: string
  original_filename: string
  file_type: string | null
}

type CharacterImportRunnerSupabaseClient = Pick<ReturnType<typeof createAdminClient>, 'from'>
type ImportJobRow = Database['public']['Tables']['charx_import_jobs']['Row']
type ImportJobUpdate = Database['public']['Tables']['charx_import_jobs']['Update']
type PendingImportJobRow = Pick<
  ImportJobRow,
  'id' | 'user_id' | 'storage_path' | 'original_filename' | 'file_type' | 'status'
>
type ProcessedJob = { jobId: string; status: 'success' | 'skipped' | 'error'; error?: string }

export async function POST(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.error('[Character Import Runner] CHAT_ADMIN_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  const auth = requireBearerToken(req, adminSecret)
  if (!auth.success) {
    console.error('[Character Import Runner] Unauthorized attempt')
    return auth.response
  }

  const body = ((await req.json().catch(() => ({}))) ?? {}) as RunnerRequest
  const limit =
    Number.isFinite(body.limit) && (body.limit ?? 0) > 0 ? Math.min(body.limit as number, 5) : 1
  const jobId = typeof body.jobId === 'string' ? body.jobId : null
  const dispatch = body.dispatch === true

  if (dispatch) {
    after(async () => {
      try {
        await processCharacterImportJobs({ limit, jobId })
      } catch (error) {
        console.error('[Character Import Runner] Background dispatch failed', error)
      }
    })

    return NextResponse.json(
      {
        accepted: true,
        dispatched: true,
      },
      { status: 202 },
    )
  }

  const results = await processCharacterImportJobs({ limit, jobId })

  return NextResponse.json(results)
}

async function processCharacterImportJobs({
  limit,
  jobId,
}: {
  limit: number
  jobId: string | null
}) {
  const jobLimit = jobId ? 1 : limit
  const supabase = createAdminClient()
  const processed: ProcessedJob[] = []

  for (let index = 0; index < jobLimit; index += 1) {
    const job = await claimPendingCharacterImportJob(supabase, jobId ?? undefined)
    if (!job) {
      if (jobId && index === 0) {
        processed.push({
          jobId,
          status: 'skipped',
          error: 'Job not found or already processed',
        })
      }
      break
    }

    try {
      await processCharacterImportJob(
        {
          jobId: job.id,
          userId: job.user_id,
          storagePath: job.storage_path,
          fileName: job.original_filename,
          fileType: job.file_type ?? undefined,
        },
        supabase,
      )
      processed.push({ jobId: job.id, status: 'success' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown runner failure'
      console.error('[Character Import Runner] Job execution failed', {
        jobId: job.id,
        error: message,
      })
      processed.push({ jobId: job.id, status: 'error', error: message })
    }
  }

  return {
    processedCount: processed.length,
    processed,
  }
}

async function claimPendingCharacterImportJob(
  supabase: CharacterImportRunnerSupabaseClient,
  jobId?: string,
): Promise<JobRow | null> {
  let query = supabase
    .from('charx_import_jobs')
    .select<'id, user_id, storage_path, original_filename, file_type, status'>(
      'id, user_id, storage_path, original_filename, file_type, status',
    )
    .eq('status', 'pending')

  if (jobId) {
    query = query.eq('id', jobId)
  } else {
    query = query.order('created_at', { ascending: true }).limit(1)
  }

  const { data: pendingJob, error } = await query.maybeSingle<PendingImportJobRow>()

  if (error) {
    if (error.code !== 'PGRST116') {
      console.error('[Character Import Runner] Failed to query pending job', error)
    }
    return null
  }

  if (!pendingJob) {
    return null
  }

  const processingUpdate: ImportJobUpdate = {
    status: 'processing',
    started_at: new Date().toISOString(),
    completed_at: null,
    error_message: null,
    result: null,
  }
  const { data: claimedJob, error: claimError } = await supabase
    .from('charx_import_jobs')
    .update(processingUpdate as never)
    .eq('id', pendingJob.id)
    .eq('status', 'pending')
    .select('id, user_id, storage_path, original_filename, file_type')
    .single<JobRow>()

  if (claimError || !claimedJob) {
    return null
  }
  return claimedJob
}
