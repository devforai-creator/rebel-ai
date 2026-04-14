import { z } from 'zod'
import { after } from 'next/server'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import { createClient } from '@/lib/supabase/server'
import {
  createApiErrorResponse,
  parseJsonRequest,
  requireAuthenticatedUser,
} from '@/lib/http/api-contract'
import {
  IMPORT_UPLOAD_BUCKET,
  MAX_IMPORT_UPLOAD_BYTES,
  MAX_IMPORT_UPLOAD_MB,
} from '@/lib/import/constants'
import {
  ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE,
  ACTIVE_QUEUE_JOB_STATUSES,
  isUniqueViolation,
} from '@/lib/queue/admission'

const ImportStorageSchema = z.object({
  path: z.string().min(1),
  fileName: z.string().min(1),
  fileType: z.string().nullish(),
  fileSize: z.number().int().positive().optional(),
})

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, ImportStorageSchema)
  if (!parsed.success) {
    return parsed.response
  }

  const { path, fileName, fileType, fileSize } = parsed.data

  if (!fileName.toLowerCase().endsWith('.rbx')) {
    return createApiErrorResponse('Supported files: .rbx only', 400)
  }

  const supabase = await createClient()
  const auth = await requireAuthenticatedUser(supabase)
  if (!auth.success) {
    return auth.response
  }
  const { user } = auth

  if (!path.startsWith(`${user.id}/`)) {
    return createApiErrorResponse('Access denied', 403)
  }

  // Early size gate — client reports fileSize, runner re-checks after download.
  // This catches obvious over-limit uploads before we even enqueue.
  if (fileSize && fileSize > MAX_IMPORT_UPLOAD_BYTES) {
    await cleanupStagedUpload(supabase, path)
    return Response.json(
      {
        error: `File size (${(fileSize / 1024 / 1024).toFixed(1)}MB) exceeds the ${MAX_IMPORT_UPLOAD_MB}MB server limit. Self-hosters can raise NEXT_PUBLIC_IMPORT_MAX_UPLOAD_MB.`,
      },
      { status: 413 },
    )
  }

  const { data: activeJobs, error: activeJobsError } = await supabase
    .from('charx_import_jobs')
    .select('id, status')
    .eq('user_id', user.id)
    .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
    .limit(1)

  if (activeJobsError) {
    console.error('[Character Import][storage] Failed to inspect active jobs:', activeJobsError)
    await cleanupStagedUpload(supabase, path)
    return createApiErrorResponse('Failed to inspect active imports', 500)
  }

  if ((activeJobs?.length ?? 0) > 0) {
    await cleanupStagedUpload(supabase, path)
    return Response.json(
      {
        error: ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE,
        existingJobId: activeJobs?.[0]?.id ?? null,
      },
      { status: 409 },
    )
  }

  const { data: job, error: jobError } = await supabase
    .from('charx_import_jobs')
    .insert({
      user_id: user.id,
      storage_path: path,
      original_filename: fileName,
      file_type: fileType ?? null,
      rights_status: 'self_owned',
      rights_attested: true,
      license_type: 'self_owned',
    })
    .select()
    .single()

  if (jobError || !job) {
    await cleanupStagedUpload(supabase, path)

    if (isUniqueViolation(jobError)) {
      return createApiErrorResponse(ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE, 409)
    }

    console.error('[Character Import][storage] Failed to enqueue job:', jobError)
    return createApiErrorResponse('Failed to enqueue import job', 500)
  }

  scheduleCharacterImportRunner(job.id)

  return Response.json({
    jobId: job.id,
    status: job.status,
  })
}

type RouteSupabaseClient = Awaited<ReturnType<typeof createClient>>

async function cleanupStagedUpload(supabase: RouteSupabaseClient, path: string): Promise<void> {
  const { error } = await supabase.storage.from(IMPORT_UPLOAD_BUCKET).remove([path])
  if (error) {
    console.error('[Character Import][storage] Failed to remove staged upload:', {
      path,
      error,
    })
  }
}

function scheduleCharacterImportRunner(jobId: string) {
  after(async () => {
    await triggerCharacterImportRunner(jobId)
  })
}

async function triggerCharacterImportRunner(jobId: string) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.warn(
      '[Character Import][storage] CHAT_ADMIN_SECRET not configured – background jobs will rely on external runners.',
    )
    return
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const endpoint = buildInternalApiUrl('/api/internal/character-import-runner/trigger')
    endpoint.searchParams.set('jobId', jobId)
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminSecret}`,
    }

    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(
        '[Character Import][storage] Failed to trigger runner route',
        response.status,
        text,
      )
    }
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      console.error('[Character Import][storage] Runner trigger timed out after 5s', {
        jobId,
      })
      return
    }

    console.error('[Character Import][storage] Runner trigger error:', error)
  } finally {
    clearTimeout(timeout)
  }
}
