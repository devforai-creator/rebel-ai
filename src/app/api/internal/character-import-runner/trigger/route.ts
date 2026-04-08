import { NextRequest, NextResponse, after } from 'next/server'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'

export const runtime = 'nodejs'
export const maxDuration = 60

const DEFAULT_BATCH_LIMIT = Number(
  process.env.CHARACTER_IMPORT_RUNNER_BATCH_LIMIT ??
    process.env.CHARX_IMPORT_RUNNER_BATCH_LIMIT ??
    '1',
)
const RUNNER_DELIVERY_TIMEOUT_MS = 10_000

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const cronSecret = process.env.CRON_SECRET

  if (!adminSecret) {
    console.error('[Character Import Runner Trigger] Missing required secrets', {
      hasAdminSecret: Boolean(adminSecret),
      hasCronSecret: Boolean(cronSecret),
    })
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')

  const isCronAuthorized = cronSecret ? authHeader === `Bearer ${cronSecret}` : false
  const isAdminAuthorized = authHeader === `Bearer ${adminSecret}`

  if (!isCronAuthorized && !isAdminAuthorized) {
    console.error('[Character Import Runner Trigger] Unauthorized access attempt', {
      hasAuthHeader: Boolean(authHeader),
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit =
    Number.isFinite(DEFAULT_BATCH_LIMIT) && DEFAULT_BATCH_LIMIT > 0 ? DEFAULT_BATCH_LIMIT : 1

  const jobId = req.nextUrl.searchParams.get('jobId')
  const endpoint = buildInternalApiUrl('/api/internal/character-import-runner')
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminSecret}`,
  }

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  after(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RUNNER_DELIVERY_TIMEOUT_MS)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ limit, jobId, dispatch: true }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        console.error('[Character Import Runner Trigger] Runner dispatch failed', {
          status: response.status,
          body: text,
          jobId,
        })
      }
    } catch (error) {
      console.error('[Character Import Runner Trigger] Failed to invoke runner', error)
    } finally {
      clearTimeout(timer)
    }
  })

  return NextResponse.json(
    {
      triggered: true,
      timestamp: Date.now(),
      jobId,
    },
    {
      status: 202,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
