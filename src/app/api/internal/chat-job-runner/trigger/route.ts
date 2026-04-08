import { NextRequest, NextResponse, after } from 'next/server'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import {
  recordChatRunnerTriggerFailure,
  recordChatRunnerTriggerSuccess,
  getChatRunnerTriggerStats,
} from '@/lib/chat/runner-trigger-monitor'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Seconds to wait for the runner request to be delivered before aborting.
 *  The runner route responds with a fast 202 dispatch ack. */
const RUNNER_DELIVERY_TIMEOUT_S = 10

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const cronSecret = process.env.CRON_SECRET

  if (!adminSecret) {
    console.error('[Chat Job Runner Trigger] Required secrets not configured', {
      hasAdminSecret: !!adminSecret,
      hasCronSecret: !!cronSecret,
    })
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  // Security: only accept bearer token auth to avoid query secret leakage in logs.
  const authHeader = req.headers.get('authorization')

  const isValidCron = cronSecret ? authHeader === `Bearer ${cronSecret}` : false
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

  // Use after() to guarantee the fetch is delivered after 202 is sent.
  // Abort after RUNNER_DELIVERY_TIMEOUT_S — the runner continues independently
  // once Vercel's router accepts the request.
  after(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RUNNER_DELIVERY_TIMEOUT_S * 1000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ limit, dispatch: true }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        const error = new Error(
          `Runner dispatch failed (${response.status}): ${text || 'Unknown error'}`,
        )
        recordChatRunnerTriggerFailure(error, { attempt: 1, status: response.status })
        console.error('[Chat Job Runner Trigger] Runner dispatch failed', {
          status: response.status,
          body: text,
        })
        return
      }

      recordChatRunnerTriggerSuccess({ attempt: 1, status: response.status, processedCount: null })
    } catch (error) {
      recordChatRunnerTriggerFailure(error, { attempt: 1 })
      console.error('[Chat Job Runner Trigger] Failed to invoke runner', error)
    } finally {
      clearTimeout(timer)
    }
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
