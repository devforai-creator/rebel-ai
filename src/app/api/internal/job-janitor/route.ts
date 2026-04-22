import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { pruneHistoricalChatJobs, resetStuckProcessingJobs } from '@/lib/chat/job-queue'
import { requireAnyBearerToken } from '@/lib/http/api-contract'
import { resetStuckImportProcessingJobs } from '@/lib/import/job-queue'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const cronSecret = process.env.CRON_SECRET

  const auth = requireAnyBearerToken(req, [adminSecret, cronSecret])
  if (!auth.success) {
    const hasConfiguredSecret = Boolean(adminSecret || cronSecret)

    if (!hasConfiguredSecret) {
      console.error('[Job Janitor] Required secrets not configured', {
        hasAdminSecret: !!adminSecret,
        hasCronSecret: !!cronSecret,
      })
    } else {
      console.error('[Job Janitor] Unauthorized access attempt', {
        hasAuthHeader: !!req.headers.get('authorization'),
      })
    }

    return auth.response
  }

  const supabase = createAdminClient()
  const [chatRecovered, importRecovered, chatPruned] = await Promise.all([
    resetStuckProcessingJobs(supabase),
    resetStuckImportProcessingJobs(supabase),
    pruneHistoricalChatJobs(supabase),
  ])

  return NextResponse.json(
    {
      ok: true,
      timestamp: Date.now(),
      recovered: {
        chatJobs: chatRecovered,
        importJobs: importRecovered,
      },
      pruned: {
        chatJobHistory: chatPruned,
      },
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}
