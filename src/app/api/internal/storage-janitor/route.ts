import { NextRequest, NextResponse, after } from 'next/server'
import {
  runStorageJanitor,
  type StorageJanitorSummary,
} from '@/lib/assets/orphaned-storage-janitor'
import { buildInternalApiUrl } from '@/lib/internal-api-origin'
import { requireAnyBearerToken, requireBearerToken } from '@/lib/http/api-contract'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

const DEFAULT_OLDER_THAN_DAYS = 1
const DEFAULT_MAX_DELETE = 500
const RUNNER_DELIVERY_TIMEOUT_MS = 10_000

type RunnerRequest = {
  dispatch?: boolean
  execute?: boolean
  olderThanDays?: number
  maxDelete?: number
  sampleSize?: number
}

export async function GET(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const cronSecret = process.env.CRON_SECRET

  if (!adminSecret) {
    console.error('[Storage Janitor Trigger] Required secrets not configured', {
      hasAdminSecret: !!adminSecret,
      hasCronSecret: !!cronSecret,
    })
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const auth = requireAnyBearerToken(req, [adminSecret, cronSecret])
  if (!auth.success) {
    console.error('[Storage Janitor Trigger] Unauthorized access attempt', {
      hasAuthHeader: !!req.headers.get('authorization'),
    })
    return auth.response
  }

  const options = resolveJanitorOptionsFromSearchParams(req)
  const endpoint = buildInternalApiUrl('/api/internal/storage-janitor')
  const headers = buildRunnerHeaders(adminSecret)

  after(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), RUNNER_DELIVERY_TIMEOUT_MS)

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          dispatch: true,
          ...options,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const text = await response.text()
        console.error('[Storage Janitor Trigger] Runner dispatch failed', {
          endpoint: endpoint.toString(),
          ...buildRunOptionsMetadata(options),
          status: response.status,
          body: text,
        })
        return
      }

      console.info('[Storage Janitor Trigger] Runner dispatch accepted', {
        endpoint: endpoint.toString(),
        ...buildRunOptionsMetadata(options),
        status: response.status,
      })
    } catch (error) {
      console.error('[Storage Janitor Trigger] Failed to invoke runner', {
        endpoint: endpoint.toString(),
        ...buildRunOptionsMetadata(options),
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      clearTimeout(timer)
    }
  })

  return NextResponse.json(
    {
      triggered: true,
      timestamp: Date.now(),
      mode: options.execute ? 'execute' : 'dry-run',
      olderThanDays: options.olderThanDays,
      maxDelete: options.maxDelete,
    },
    {
      status: 202,
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.error('[Storage Janitor Runner] CHAT_ADMIN_SECRET is not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const auth = requireBearerToken(req, adminSecret)
  if (!auth.success) {
    console.error('[Storage Janitor Runner] Unauthorized attempt')
    return auth.response
  }

  const body = ((await req.json().catch(() => ({}))) ?? {}) as RunnerRequest
  const options = resolveJanitorOptionsFromBody(body)

  if (body.dispatch === true) {
    console.info(
      '[Storage Janitor Runner] Background dispatch accepted',
      buildRunOptionsMetadata(options),
    )

    after(async () => {
      try {
        const results = await runAllStorageJanitors(options)
        console.info(
          '[Storage Janitor Runner] Completed background run',
          buildRunCompletionMetadata(options, results),
        )
      } catch (error) {
        console.error('[Storage Janitor Runner] Background dispatch failed', {
          ...buildRunOptionsMetadata(options),
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    return NextResponse.json(
      {
        accepted: true,
        dispatched: true,
        mode: options.execute ? 'execute' : 'dry-run',
      },
      { status: 202 },
    )
  }

  try {
    const results = await runAllStorageJanitors(options)
    console.info(
      '[Storage Janitor Runner] Completed synchronous run',
      buildRunCompletionMetadata(options, results),
    )

    return NextResponse.json(
      {
        ok: true,
        timestamp: Date.now(),
        mode: options.execute ? 'execute' : 'dry-run',
        olderThanDays: options.olderThanDays,
        maxDelete: options.maxDelete,
        results,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  } catch (error) {
    console.error('[Storage Janitor Runner] Synchronous run failed', {
      ...buildRunOptionsMetadata(options),
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

async function runAllStorageJanitors(options: {
  execute: boolean
  olderThanDays: number
  maxDelete: number
  sampleSize?: number
}) {
  const supabase = createAdminClient()

  const [characterAssets, moduleAssets] = await Promise.all([
    runStorageJanitor(supabase, {
      bucket: 'character-assets',
      table: 'character_assets',
      olderThanDays: options.olderThanDays,
      maxDelete: options.maxDelete,
      sampleSize: options.sampleSize,
      execute: options.execute,
    }),
    runStorageJanitor(supabase, {
      bucket: 'module-assets',
      table: 'module_assets',
      olderThanDays: options.olderThanDays,
      maxDelete: options.maxDelete,
      sampleSize: options.sampleSize,
      execute: options.execute,
    }),
  ])

  return {
    characterAssets,
    moduleAssets,
  }
}

function buildRunOptionsMetadata(options: {
  execute: boolean
  olderThanDays: number
  maxDelete: number
  sampleSize?: number
}) {
  return {
    mode: options.execute ? 'execute' : 'dry-run',
    olderThanDays: options.olderThanDays,
    maxDelete: options.maxDelete,
    sampleSize: options.sampleSize ?? null,
  }
}

function buildRunCompletionMetadata(
  options: {
    execute: boolean
    olderThanDays: number
    maxDelete: number
    sampleSize?: number
  },
  results: Awaited<ReturnType<typeof runAllStorageJanitors>>,
) {
  return {
    ...buildRunOptionsMetadata(options),
    summary: summarizeRunResults(results),
  }
}

function summarizeRunResults(results: Awaited<ReturnType<typeof runAllStorageJanitors>>) {
  return {
    characterAssets: summarizeBucketResult(results.characterAssets),
    moduleAssets: summarizeBucketResult(results.moduleAssets),
    totalOrphans: results.characterAssets.orphanCount + results.moduleAssets.orphanCount,
    totalDeleted: results.characterAssets.deletedCount + results.moduleAssets.deletedCount,
  }
}

function summarizeBucketResult(result: StorageJanitorSummary) {
  return {
    objectsScanned: result.objectsScanned,
    orphanCount: result.orphanCount,
    deletedCount: result.deletedCount,
    reachedDeleteLimit: result.reachedDeleteLimit,
    sample: result.sample,
  }
}

function resolveJanitorOptionsFromSearchParams(req: NextRequest) {
  return {
    execute: req.nextUrl.searchParams.get('dryRun') !== '1',
    olderThanDays:
      readPositiveInt(req.nextUrl.searchParams.get('olderThanDays')) ?? DEFAULT_OLDER_THAN_DAYS,
    maxDelete: readPositiveInt(req.nextUrl.searchParams.get('maxDelete')) ?? DEFAULT_MAX_DELETE,
    sampleSize: readPositiveInt(req.nextUrl.searchParams.get('sampleSize')) ?? undefined,
  }
}

function resolveJanitorOptionsFromBody(body: RunnerRequest) {
  return {
    execute: body.execute ?? true,
    olderThanDays: normalizePositiveInt(body.olderThanDays) ?? DEFAULT_OLDER_THAN_DAYS,
    maxDelete: normalizePositiveInt(body.maxDelete) ?? DEFAULT_MAX_DELETE,
    sampleSize: normalizePositiveInt(body.sampleSize) ?? undefined,
  }
}

function buildRunnerHeaders(adminSecret: string): HeadersInit {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminSecret}`,
  }

  if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  }

  return headers
}

function readPositiveInt(raw: string | null): number | null {
  if (!raw) {
    return null
  }

  return normalizePositiveInt(Number.parseInt(raw, 10))
}

function normalizePositiveInt(value: number | undefined): number | null {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) {
    return null
  }

  return Math.trunc(value as number)
}
