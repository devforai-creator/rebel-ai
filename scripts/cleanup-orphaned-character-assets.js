#!/usr/bin/env node

/**
 * One-off cleanup for orphaned objects in the `character-assets` bucket.
 *
 * It compares Storage objects against `public.character_assets.storage_path`
 * and deletes only objects that have no matching database row.
 *
 * Default mode is dry-run. Pass `--execute` to actually delete objects.
 *
 * This script intentionally uses the linked Supabase CLI instead of requiring
 * local service-role env vars so it can run in the current repository setup.
 *
 * Usage:
 *   npm run cleanup:character-assets
 *   npm run cleanup:character-assets -- --prefix user-id
 *   npm run cleanup:character-assets -- --older-than-days 30
 *   npm run cleanup:character-assets -- --execute --delete-batch-size 100
 *   npm run cleanup:character-assets -- --execute --prefix user-id --max-delete 5000
 */

const { execFileSync } = require('node:child_process')

const BUCKET = 'character-assets'
const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_DELETE_BATCH_SIZE = 100
const DEFAULT_SAMPLE_SIZE = 20
const MAX_BUFFER_BYTES = 32 * 1024 * 1024

const options = parseArgs(process.argv.slice(2))

function main() {
  printRunHeader()

  const pathSet = loadCharacterAssetPathSet()
  console.log(`Loaded ${pathSet.size.toLocaleString()} character_assets paths from DB.`)

  const result = scanAndMaybeDeleteOrphans(pathSet)
  printSummary(result)
}

function parseArgs(argv) {
  return {
    execute: hasFlag(argv, '--execute'),
    prefix: readFlagValue(argv, '--prefix') ?? null,
    pageSize: readPositiveInt(argv, '--page-size', DEFAULT_PAGE_SIZE),
    deleteBatchSize: readPositiveInt(argv, '--delete-batch-size', DEFAULT_DELETE_BATCH_SIZE),
    sampleSize: readPositiveInt(argv, '--sample-size', DEFAULT_SAMPLE_SIZE),
    maxDelete: readOptionalPositiveInt(argv, '--max-delete'),
    olderThanDays: readOptionalPositiveInt(argv, '--older-than-days'),
  }
}

function hasFlag(argv, flag) {
  return argv.includes(flag)
}

function readFlagValue(argv, flag) {
  const exactIndex = argv.indexOf(flag)
  if (exactIndex >= 0) {
    return argv[exactIndex + 1] ?? null
  }

  const prefixed = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (!prefixed) {
    return null
  }

  return prefixed.slice(flag.length + 1)
}

function readPositiveInt(argv, flag, fallback) {
  const raw = readFlagValue(argv, flag)
  if (!raw) {
    return fallback
  }

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }

  return value
}

function readOptionalPositiveInt(argv, flag) {
  const raw = readFlagValue(argv, flag)
  if (!raw) {
    return null
  }

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }

  return value
}

function printRunHeader() {
  console.log('[cleanup:character-assets] Starting orphan scan')
  console.log(
    JSON.stringify(
      {
        bucket: BUCKET,
        mode: options.execute ? 'execute' : 'dry-run',
        prefix: options.prefix,
        pageSize: options.pageSize,
        deleteBatchSize: options.deleteBatchSize,
        sampleSize: options.sampleSize,
        maxDelete: options.maxDelete,
        olderThanDays: options.olderThanDays,
      },
      null,
      2,
    ),
  )
}

function buildOlderThanIso() {
  if (!options.olderThanDays) {
    return null
  }

  const cutoffMs = Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000
  return new Date(cutoffMs).toISOString()
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function runSupabase(args) {
  try {
    return execFileSync('supabase', args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: MAX_BUFFER_BYTES,
    }).trim()
  } catch (error) {
    const stderr =
      typeof error?.stderr === 'string'
        ? error.stderr
        : Buffer.isBuffer(error?.stderr)
          ? error.stderr.toString('utf8')
          : ''
    const stdout =
      typeof error?.stdout === 'string'
        ? error.stdout
        : Buffer.isBuffer(error?.stdout)
          ? error.stdout.toString('utf8')
          : ''
    const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
    throw new Error(details || error.message || 'Supabase CLI command failed')
  }
}

function queryRows(sql) {
  const output = runSupabase(['--agent=yes', 'db', 'query', '--linked', '-o', 'json', sql])
  const parsed = JSON.parse(output)
  return Array.isArray(parsed?.rows) ? parsed.rows : []
}

function removeStoragePaths(paths) {
  if (paths.length === 0) {
    return 0
  }

  const objectRefs = paths.map((value) => `ss:///${BUCKET}/${value}`)
  runSupabase(['--experimental', '--yes', 'storage', 'rm', '--linked', ...objectRefs])
  return paths.length
}

function loadCharacterAssetPathSet() {
  const pathSet = new Set()
  let cursor = null
  let page = 0

  while (true) {
    const filters = []

    if (options.prefix) {
      filters.push(`storage_path like ${sqlLiteral(`${options.prefix}/%`)}`)
    }

    if (cursor) {
      filters.push(`storage_path > ${sqlLiteral(cursor)}`)
    }

    const whereClause = filters.length > 0 ? `where ${filters.join(' and ')}` : ''
    const sql = `
      select storage_path
      from public.character_assets
      ${whereClause}
      order by storage_path asc
      limit ${options.pageSize}
    `

    const rows = queryRows(sql)

    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      if (typeof row.storage_path === 'string' && row.storage_path.length > 0) {
        pathSet.add(row.storage_path)
      }
    }

    cursor = rows[rows.length - 1].storage_path
    page += 1

    if (page % 10 === 0) {
      console.log(
        `[cleanup:character-assets] Loaded ${pathSet.size.toLocaleString()} DB paths so far...`,
      )
    }
  }

  return pathSet
}

function scanAndMaybeDeleteOrphans(pathSet) {
  const sample = []
  const olderThanIso = buildOlderThanIso()
  const deleteBuffer = []

  let cursor = null
  let objectsScanned = 0
  let orphanCount = 0
  let deletedCount = 0
  let page = 0
  let reachedDeleteLimit = false

  while (true) {
    const filters = [`bucket_id = ${sqlLiteral(BUCKET)}`]

    if (options.prefix) {
      filters.push(`name like ${sqlLiteral(`${options.prefix}/%`)}`)
    }

    if (olderThanIso) {
      filters.push(`created_at < ${sqlLiteral(olderThanIso)}`)
    }

    if (cursor) {
      filters.push(`name > ${sqlLiteral(cursor)}`)
    }

    const sql = `
      select name, created_at
      from storage.objects
      where ${filters.join(' and ')}
      order by name asc
      limit ${options.pageSize}
    `

    const rows = queryRows(sql)

    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      objectsScanned += 1

      if (pathSet.has(row.name)) {
        continue
      }

      orphanCount += 1

      if (sample.length < options.sampleSize) {
        sample.push({
          storagePath: row.name,
          createdAt: row.created_at,
        })
      }

      if (!options.execute) {
        continue
      }

      if (options.maxDelete && deletedCount + deleteBuffer.length >= options.maxDelete) {
        reachedDeleteLimit = true
        break
      }

      deleteBuffer.push(row.name)

      if (deleteBuffer.length >= options.deleteBatchSize) {
        deletedCount += removeStoragePaths(deleteBuffer.splice(0, deleteBuffer.length))
      }
    }

    page += 1
    cursor = rows[rows.length - 1].name

    if (page % 10 === 0) {
      console.log(
        `[cleanup:character-assets] Scanned ${objectsScanned.toLocaleString()} storage objects, found ${orphanCount.toLocaleString()} orphans${options.execute ? `, deleted ${deletedCount.toLocaleString()}` : ''}.`,
      )
    }

    if (reachedDeleteLimit) {
      break
    }
  }

  if (options.execute && deleteBuffer.length > 0) {
    deletedCount += removeStoragePaths(deleteBuffer.splice(0, deleteBuffer.length))
  }

  return {
    objectsScanned,
    orphanCount,
    deletedCount,
    sample,
    olderThanIso,
    reachedDeleteLimit,
  }
}

function printSummary(result) {
  console.log('[cleanup:character-assets] Summary')
  console.log(
    JSON.stringify(
      {
        mode: options.execute ? 'execute' : 'dry-run',
        bucket: BUCKET,
        prefix: options.prefix,
        olderThanIso: result.olderThanIso,
        objectsScanned: result.objectsScanned,
        orphanCount: result.orphanCount,
        deletedCount: result.deletedCount,
        reachedDeleteLimit: result.reachedDeleteLimit,
      },
      null,
      2,
    ),
  )

  if (result.sample.length > 0) {
    console.log('[cleanup:character-assets] Sample orphan paths:')
    for (const row of result.sample) {
      console.log(`- ${row.createdAt} ${row.storagePath}`)
    }
  }

  if (!options.execute) {
    console.log('[cleanup:character-assets] Dry run only. Re-run with --execute to delete.')
  }
}

try {
  main()
} catch (error) {
  console.error('[cleanup:character-assets] Failed:', error)
  process.exit(1)
}
