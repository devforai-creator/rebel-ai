import { NextRequest, NextResponse, after } from 'next/server'
import {
  recordChatRunnerTriggerFailure,
  recordChatRunnerTriggerSuccess,
  getChatRunnerTriggerStats,
} from '@/lib/chat/runner-trigger-monitor'
import { requireAnyBearerToken } from '@/lib/http/api-contract'
import { processChatJobs } from '../service'

export const runtime = 'nodejs'
// Static literal required by Next.js route-segment analysis. Keep synchronized
// with CHAT_RUNNER_LIMITS.routeMaxDurationSeconds.
export const maxDuration = 800

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

  const auth = requireAnyBearerToken(req, [adminSecret, cronSecret])
  if (!auth.success) {
    console.error('[Chat Job Runner Trigger] Unauthorized access attempt', {
      hasAuthHeader: !!req.headers.get('authorization'),
    })
    return auth.response
  }

  const limit = resolveBatchLimit()
  after(async () => {
    try {
      const result = await processChatJobs(limit)
      await recordChatRunnerTriggerSuccess({
        attempt: 1,
        status: 202,
        processedCount: result.processedCount,
      })
    } catch (error) {
      await recordChatRunnerTriggerFailure(error, { attempt: 1 })
      console.error('[Chat Job Runner Trigger] Failed to process queued jobs', error)
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
