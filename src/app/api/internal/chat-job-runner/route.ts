import { NextRequest, NextResponse } from 'next/server'
import { processChatJobs } from './service'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.error('[Chat Job Runner] CHAT_ADMIN_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
    console.error('[Chat Job Runner] Auth failed', {
      hasAuthHeader: !!authHeader,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { limit = 1 } = ((await req.json().catch(() => ({}))) as { limit?: number }) ?? {}

  const results = await processChatJobs(limit)

  return NextResponse.json(results)
}
