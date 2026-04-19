import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { pruneHistoricalChatJobs, resetStuckProcessingJobs } from '@/lib/chat/job-queue'
import { resetStuckImportProcessingJobs } from '@/lib/import/job-queue'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const cronSecret = process.env.CRON_SECRET

  if (!adminSecret || !cronSecret) {
    console.error('[Job Janitor] Required secrets not configured', {
      hasAdminSecret: !!adminSecret,
      hasCronSecret: !!cronSecret,
    })
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  const isValidCron = authHeader === `Bearer ${cronSecret}`
  const isValidAdmin = authHeader === `Bearer ${adminSecret}`

  if (!isValidCron && !isValidAdmin) {
    console.error('[Job Janitor] Unauthorized access attempt', {
      hasAuthHeader: !!authHeader,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
