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
import { buildImportUploadPath, isImportUploadPath } from '@/lib/import/upload-path'
import { createImportUploadTicket, verifyImportUploadTicket } from '@/lib/import/upload-ticket'
import {
  ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE,
  ACTIVE_QUEUE_JOB_STATUSES,
  isUniqueViolation,
} from '@/lib/queue/admission'

const PrepareImportStorageSchema = z.object({
  action: z.literal('prepare'),
  fileName: z.string().min(1),
  fileType: z.string().nullish(),
  fileSize: z.number().int().positive(),
})

const EnqueueImportStorageSchema = z.object({
  action: z.literal('enqueue'),
  path: z.string().min(1),
  fileName: z.string().min(1),
  fileType: z.string().nullish(),
  fileSize: z.number().int().positive().optional(),
  uploadTicket: z.string().min(1),
})

const ImportStorageSchema = z.discriminatedUnion('action', [
  PrepareImportStorageSchema,
  EnqueueImportStorageSchema,
])

const IMPORT_UPLOAD_TICKET_TTL_MS = 15 * 60 * 1000

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const parsed = await parseJsonRequest(request, ImportStorageSchema)
  if (!parsed.success) {
    return parsed.response
  }

  const { fileName } = parsed.data

  if (!fileName.toLowerCase().endsWith('.rbx')) {
    return createApiErrorResponse('Supported files: .rbx only', 400)
  }

  const supabase = await createClient()
  const auth = await requireAuthenticatedUser(supabase)
  if (!auth.success) {
    return auth.response
  }

  const { user } = auth

  if (parsed.data.action === 'prepare') {
    const activeImportCheck = await inspectActiveImportJobs(supabase, user.id)
    if (!activeImportCheck.ok) {
      return activeImportCheck.response
    }

    if (activeImportCheck.activeJobId) {
      return Response.json(
        {
          error: ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE,
          existingJobId: activeImportCheck.activeJobId,
        },
        { status: 409 },
      )
    }

    return issueImportUploadContract({
      supabase,
      userId: user.id,
      fileName: parsed.data.fileName,
      fileType: parsed.data.fileType ?? null,
      fileSize: parsed.data.fileSize,
    })
  }

  return enqueueImportUpload({
    supabase,
    userId: user.id,
    path: parsed.data.path,
    fileName: parsed.data.fileName,
    fileType: parsed.data.fileType ?? null,
    fileSize: parsed.data.fileSize,
    uploadTicket: parsed.data.uploadTicket,
  })
}

type RouteSupabaseClient = Awaited<ReturnType<typeof createClient>>

async function inspectActiveImportJobs(supabase: RouteSupabaseClient, userId: string) {
  const { data: activeJobs, error: activeJobsError } = await supabase
    .from('charx_import_jobs')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
    .limit(1)

  if (activeJobsError) {
    console.error('[Character Import][storage] Failed to inspect active jobs:', activeJobsError)
    return {
      ok: false as const,
      response: createApiErrorResponse('Failed to inspect active imports', 500),
    }
  }

  return {
    ok: true as const,
    activeJobId: activeJobs?.[0]?.id ?? null,
  }
}

async function issueImportUploadContract({
  supabase,
  userId,
  fileName,
  fileType,
  fileSize,
}: {
  supabase: RouteSupabaseClient
  userId: string
  fileName: string
  fileType: string | null
  fileSize: number
}) {
  if (fileSize > MAX_IMPORT_UPLOAD_BYTES) {
    return Response.json(
      {
        error: `File size (${(fileSize / 1024 / 1024).toFixed(1)}MB) exceeds the ${MAX_IMPORT_UPLOAD_MB}MB server limit. Self-hosters can raise NEXT_PUBLIC_IMPORT_MAX_UPLOAD_MB.`,
      },
      { status: 413 },
    )
  }

  const path = buildImportUploadPath(userId, { name: fileName })
  const { data: signedUpload, error: signedUploadError } = await supabase.storage
    .from(IMPORT_UPLOAD_BUCKET)
    .createSignedUploadUrl(path, {
      upsert: false,
    })

  if (signedUploadError || !signedUpload?.path || !signedUpload.signedUrl || !signedUpload.token) {
    console.error(
      '[Character Import][storage] Failed to create signed upload contract:',
      signedUploadError,
    )
    return createApiErrorResponse('Failed to prepare upload', 500)
  }

  const uploadTicket = createImportUploadTicket({
    userId,
    path: signedUpload.path,
    fileName,
    fileType,
    fileSize,
    expiresAt: Date.now() + IMPORT_UPLOAD_TICKET_TTL_MS,
  })

  if (!uploadTicket) {
    console.error('[Character Import][storage] Upload ticket signing secret is not configured')
    return createApiErrorResponse('Failed to prepare upload', 500)
  }

  return Response.json({
    path: signedUpload.path,
    signedUrl: signedUpload.signedUrl,
    token: signedUpload.token,
    uploadTicket,
  })
}

async function enqueueImportUpload({
  supabase,
  userId,
  path,
  fileName,
  fileType,
  fileSize,
  uploadTicket,
}: {
  supabase: RouteSupabaseClient
  userId: string
  path: string
  fileName: string
  fileType: string | null
  fileSize?: number
  uploadTicket: string
}) {
  if (!isImportUploadPath(path, userId)) {
    return createApiErrorResponse('Access denied', 403)
  }

  const verification = verifyImportUploadTicket(uploadTicket)
  if (!verification.ok) {
    if (verification.reason === 'missing_secret') {
      console.error('[Character Import][storage] Upload ticket signing secret is not configured')
      return createApiErrorResponse('Failed to verify upload reference', 500)
    }

    if (
      verification.reason === 'expired' &&
      verification.claims.userId === userId &&
      verification.claims.path === path
    ) {
      await cleanupStagedUpload(supabase, path)
    }

    return createApiErrorResponse('Invalid upload reference', 403)
  }

  const { claims } = verification
  if (
    claims.userId !== userId ||
    claims.path !== path ||
    claims.fileName !== fileName ||
    claims.fileType !== fileType ||
    claims.fileSize !== (fileSize ?? claims.fileSize)
  ) {
    return createApiErrorResponse('Invalid upload reference', 403)
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

  const activeImportCheck = await inspectActiveImportJobs(supabase, userId)
  if (!activeImportCheck.ok) {
    await cleanupStagedUpload(supabase, path)
    return activeImportCheck.response
  }

  if (activeImportCheck.activeJobId) {
    await cleanupStagedUpload(supabase, path)
    return Response.json(
      {
        error: ACTIVE_IMPORT_JOB_CONFLICT_MESSAGE,
        existingJobId: activeImportCheck.activeJobId,
      },
      { status: 409 },
    )
  }

  const { data: job, error: jobError } = await supabase
    .from('charx_import_jobs')
    .insert({
      user_id: userId,
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
