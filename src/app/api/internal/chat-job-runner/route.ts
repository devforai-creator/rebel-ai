import { NextRequest, NextResponse, after } from 'next/server'
import { requireBearerToken } from '@/lib/http/api-contract'
import { processChatJobs } from './service'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.error('[Chat Job Runner] CHAT_ADMIN_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const auth = requireBearerToken(req, adminSecret)
  if (!auth.success) {
    console.error('[Chat Job Runner] Auth failed', {
      hasAuthHeader: !!req.headers.get('authorization'),
    })
    return auth.response
  }

  const { limit = 1, dispatch = false } =
    ((await req.json().catch(() => ({}))) as {
      limit?: number
      dispatch?: boolean
    }) ?? {}

  if (dispatch === true) {
    after(async () => {
      try {
        await processChatJobs(limit)
      } catch (error) {
        console.error('[Chat Job Runner] Background dispatch failed', error)
      }
    })

    return NextResponse.json(
      {
        accepted: true,
        dispatched: true,
      },
      { status: 202 },
    )
  }

  const results = await processChatJobs(limit)

  return NextResponse.json(results)
}
