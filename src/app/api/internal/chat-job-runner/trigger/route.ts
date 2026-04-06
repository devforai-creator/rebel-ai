import { NextRequest, NextResponse } from 'next/server'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import {
  recordChatRunnerTriggerFailure,
  recordChatRunnerTriggerSuccess,
  getChatRunnerTriggerStats,
} from '@/lib/chat/runner-trigger-monitor'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const cronSecret = process.env.CRON_SECRET

  if (!adminSecret || !cronSecret) {
    console.error('[Chat Job Runner Trigger] Required secrets not configured', {
      hasAdminSecret: !!adminSecret,
      hasCronSecret: !!cronSecret,
    })
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // Security: only accept bearer token auth to avoid query secret leakage in logs.
  const authHeader = req.headers.get('authorization')

  const isValidCron = authHeader === `Bearer ${cronSecret}`
  const isValidAdmin = authHeader === `Bearer ${adminSecret}`

  if (!isValidCron && !isValidAdmin) {
    console.error('[Chat Job Runner Trigger] Unauthorized access attempt', {
      hasAuthHeader: !!authHeader,
      cronAuthMatch: authHeader === `Bearer ${cronSecret}`,
      authMatch: authHeader === `Bearer ${adminSecret}`,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit = resolveBatchLimit()
  const endpoint = buildInternalApiUrl('/api/internal/chat-job-runner')
  const headers = buildAuthHeaders(adminSecret)
  const body = JSON.stringify({ limit })

  // Fire-and-forget: trigger job runner without waiting for response
  // This prevents cron timeout when LLM generation takes > 300 seconds
  // Job runner runs as independent serverless instance
  fetch(endpoint, { method: 'POST', headers, body })
    .then(() => {
      recordChatRunnerTriggerSuccess({ attempt: 1, status: 200, processedCount: null })
    })
    .catch((error) => {
      recordChatRunnerTriggerFailure(error, { attempt: 1 })
      console.error('[Chat Job Runner Trigger] Failed to invoke runner', error)
    })

  return NextResponse.json(
    {
      triggered: true,
      timestamp: Date.now(),
      triggerStats: getChatRunnerTriggerStats(),
    },
    {
      status: 202,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

function resolveBatchLimit(): number {
  const raw = Number(process.env.CHAT_JOB_RUNNER_BATCH_LIMIT ?? '2')
  if (!Number.isFinite(raw) || raw < 1) {
    return 1
  }
  return Math.min(Math.trunc(raw), 10)
}

function buildAuthHeaders(adminSecret: string): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminSecret}`,
  }

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  return headers
}
