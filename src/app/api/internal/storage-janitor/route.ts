import { NextRequest, NextResponse } from 'next/server'
import { runStorageJanitor } from '@/lib/assets/orphaned-storage-janitor'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 60

const DEFAULT_OLDER_THAN_DAYS = 1
const DEFAULT_MAX_DELETE = 500

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const cronSecret = process.env.CRON_SECRET

  if (!adminSecret || !cronSecret) {
    console.error('[Storage Janitor] Required secrets not configured', {
      hasAdminSecret: !!adminSecret,
      hasCronSecret: !!cronSecret,
    })
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  const isValidCron = authHeader === `Bearer ${cronSecret}`
  const isValidAdmin = authHeader === `Bearer ${adminSecret}`

  if (!isValidCron && !isValidAdmin) {
    console.error('[Storage Janitor] Unauthorized access attempt', {
      hasAuthHeader: !!authHeader,
    })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const olderThanDays = readPositiveInt(req, 'olderThanDays') ?? DEFAULT_OLDER_THAN_DAYS
  const maxDelete = readPositiveInt(req, 'maxDelete') ?? DEFAULT_MAX_DELETE
  const sampleSize = readPositiveInt(req, 'sampleSize')
  const execute = req.nextUrl.searchParams.get('dryRun') !== '1'

  const supabase = createAdminClient()
  const [characterAssets, moduleAssets] = await Promise.all([
    runStorageJanitor(supabase, {
      bucket: 'character-assets',
      table: 'character_assets',
      olderThanDays,
      maxDelete,
      sampleSize: sampleSize ?? undefined,
      execute,
    }),
    runStorageJanitor(supabase, {
      bucket: 'module-assets',
      table: 'module_assets',
      olderThanDays,
      maxDelete,
      sampleSize: sampleSize ?? undefined,
      execute,
    }),
  ])

  return NextResponse.json(
    {
      ok: true,
      timestamp: Date.now(),
      mode: execute ? 'execute' : 'dry-run',
      olderThanDays,
      maxDelete,
      results: {
        characterAssets,
        moduleAssets,
      },
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

function readPositiveInt(req: NextRequest, key: string): number | null {
  const raw = req.nextUrl.searchParams.get(key)
  if (!raw) {
    return null
  }

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    return null
  }

  return value
}
