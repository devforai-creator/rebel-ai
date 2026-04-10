import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'

const STALE_JOB_TIMEOUT_MS = 15 * 60 * 1000

function getChatAdminSecret(): string | null {
  return process.env.CHAT_ADMIN_SECRET ?? null
}

type RouteParams = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_request: NextRequest, context: RouteParams) {
  const { id } = await context.params
  const jobId = id

  if (!jobId) {
    return NextResponse.json({ error: 'Job ID required' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: job, error } = await supabase
    .from('charx_import_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single()

  if (error && error.code === 'PGRST116') {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  if (error) {
    console.error('[Character Import][jobs] Failed to fetch job:', error)
    return NextResponse.json({ error: 'Failed to load job' }, { status: 500 })
  }

  let jobRecord = job

  if (job.status === 'processing') {
    const referenceTime = job.started_at ?? job.created_at
    if (referenceTime) {
      const elapsedMs = Date.now() - new Date(referenceTime).getTime()
      if (elapsedMs > STALE_JOB_TIMEOUT_MS) {
        // Use internal admin API to update job status (bypasses RLS)
        const timedOutJob = await markJobAsTimedOut({
          jobId,
          jobType: 'charx',
          userId: user.id,
          errorMessage: 'Character import timed out. Please retry.',
        })
        if (timedOutJob) {
          jobRecord = { ...jobRecord, ...timedOutJob }
        }
      }
    }
  }

  return NextResponse.json({
    id: jobRecord.id,
    status: jobRecord.status,
    error: jobRecord.error_message,
    result: jobRecord.result,
    createdAt: jobRecord.created_at,
    startedAt: jobRecord.started_at,
    completedAt: jobRecord.completed_at,
  })
}

async function markJobAsTimedOut(params: {
  jobId: string
  jobType: 'charx'
  userId: string
  errorMessage: string
}): Promise<{ status: string; error_message: string; completed_at: string } | null> {
  const chatAdminSecret = getChatAdminSecret()

  if (!chatAdminSecret) {
    console.warn(
      '[Character Import][jobs] CHAT_ADMIN_SECRET not configured, cannot mark job timeout',
    )
    return null
  }

  try {
    const endpoint = buildInternalApiUrl('/api/internal/import-job-timeout')
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chatAdminSecret}`,
    }

    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error('[Character Import][jobs] Failed to mark job timeout via admin API', {
        status: response.status,
        body: text,
      })
      return null
    }

    const result = await response.json()
    if (result.updated && result.job) {
      return {
        status: result.job.status,
        error_message: result.job.error_message,
        completed_at: result.job.completed_at,
      }
    }
    return null
  } catch (error) {
    console.error('[Character Import][jobs] Error calling admin timeout API:', error)
    return null
  }
}
