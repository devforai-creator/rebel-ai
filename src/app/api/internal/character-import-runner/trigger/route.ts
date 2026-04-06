import { NextRequest, NextResponse } from 'next/server'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'

export const runtime = 'nodejs'
export const maxDuration = 60

const DEFAULT_BATCH_LIMIT = Number(
  process.env.CHARACTER_IMPORT_RUNNER_BATCH_LIMIT ??
    process.env.CHARX_IMPORT_RUNNER_BATCH_LIMIT ??
    '1',
)

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const cronSecret = process.env.CRON_SECRET

  if (!adminSecret || !cronSecret) {
    console.error('[Character Import Runner Trigger] Missing required secrets', {
      hasAdminSecret: Boolean(adminSecret),
      hasCronSecret: Boolean(cronSecret),
    })
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')

  const isCronAuthorized = authHeader === `Bearer ${cronSecret}`
  const isAdminAuthorized = authHeader === `Bearer ${adminSecret}`

  if (!isCronAuthorized && !isAdminAuthorized) {
    console.error('[Character Import Runner Trigger] Unauthorized access attempt', {
      hasAuthHeader: Boolean(authHeader),
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const limit =
    Number.isFinite(DEFAULT_BATCH_LIMIT) && DEFAULT_BATCH_LIMIT > 0 ? DEFAULT_BATCH_LIMIT : 1

  const endpoint = buildInternalApiUrl('/api/internal/character-import-runner')

  try {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminSecret}`,
    }

    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
      headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ limit }),
    })

    const payload = await response.text()
    return new NextResponse(payload, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('[Character Import Runner Trigger] Failed to invoke runner', error)
    return NextResponse.json({ error: 'Failed to invoke character import runner' }, { status: 500 })
  }
}
