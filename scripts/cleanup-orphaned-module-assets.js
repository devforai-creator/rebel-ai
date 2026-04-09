#!/usr/bin/env node

/**
 * One-off cleanup for orphaned objects in the `module-assets` bucket.
 *
 * It compares Storage objects against `public.module_assets.storage_path`
 * and deletes only objects that have no matching database row.
 *
 * Default mode is dry-run. Pass `--execute` to actually delete objects.
 *
 * This script intentionally uses the linked Supabase CLI instead of requiring
 * local service-role env vars so it can run in the current repository setup.
 *
 * Usage:
 *   npm run cleanup:module-assets
 *   npm run cleanup:module-assets -- --prefix user-id
 *   npm run cleanup:module-assets -- --older-than-days 30
 *   npm run cleanup:module-assets -- --execute --delete-batch-size 100
 *   npm run cleanup:module-assets -- --execute --prefix user-id --max-delete 5000
 */

const {
  loadSupabaseRestConfig,
  runSupabase,
  selectPage,
  walkStorageObjects,
} = require('./supabase-rest-client')

const BUCKET = 'module-assets'
const TABLE = 'module_assets'
const SCRIPT_NAME = 'cleanup:module-assets'
const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_DELETE_BATCH_SIZE = 100
const DEFAULT_SAMPLE_SIZE = 20

const options = parseArgs(process.argv.slice(2))
const restConfig = loadSupabaseRestConfig()

async function main() {
  printRunHeader()

  const pathSet = await loadStoragePathSet()
  console.log(`Loaded ${pathSet.size.toLocaleString()} ${TABLE} paths from DB.`)

  const result = await scanAndMaybeDeleteOrphans(pathSet)
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
  console.log(`[${SCRIPT_NAME}] Starting orphan scan`)
  console.log(
    JSON.stringify(
      {
        bucket: BUCKET,
        table: TABLE,
        projectRef: restConfig.projectRef,
        authMode: 'service-role-rest',
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

function removeStoragePaths(paths) {
  if (paths.length === 0) {
    return 0
  }

  const objectRefs = paths.map((value) => `ss:///${BUCKET}/${value}`)
  runSupabase(['--experimental', '--yes', 'storage', 'rm', '--linked', ...objectRefs])
  return paths.length
}

async function loadStoragePathSet() {
  const pathSet = new Set()
  let cursor = null
  let page = 0

  while (true) {
    const filters = []

    if (options.prefix) {
      filters.push({
        column: 'storage_path',
        operator: 'like',
        value: `${options.prefix}/%`,
      })
    }

    const rows = await selectPage(restConfig, {
      table: TABLE,
      select: 'storage_path',
      orderBy: 'storage_path',
      limit: options.pageSize,
      cursor,
      filters,
    })

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
      console.log(`[${SCRIPT_NAME}] Loaded ${pathSet.size.toLocaleString()} DB paths so far...`)
    }
  }

  return pathSet
}

async function scanAndMaybeDeleteOrphans(pathSet) {
  const sample = []
  const olderThanIso = buildOlderThanIso()
  const deleteBuffer = []

  let objectsScanned = 0
  let orphanCount = 0
  let deletedCount = 0
  let reachedDeleteLimit = false

  await walkStorageObjects(restConfig, {
    bucket: BUCKET,
    prefix: options.prefix ?? '',
    pageSize: options.pageSize,
    onFile: async (row) => {
      if (reachedDeleteLimit) {
        return
      }

      if (olderThanIso && (!row.createdAt || row.createdAt >= olderThanIso)) {
        return
      }

      objectsScanned += 1

      if (pathSet.has(row.storagePath)) {
        return
      }

      orphanCount += 1

      if (sample.length < options.sampleSize) {
        sample.push({
          storagePath: row.storagePath,
          createdAt: row.createdAt,
        })
      }

      if (!options.execute) {
        return
      }

      if (options.maxDelete && deletedCount + deleteBuffer.length >= options.maxDelete) {
        reachedDeleteLimit = true
        return
      }

      deleteBuffer.push(row.storagePath)

      if (deleteBuffer.length >= options.deleteBatchSize) {
        deletedCount += removeStoragePaths(deleteBuffer.splice(0, deleteBuffer.length))
      }
    },
    onProgress: ({ filesScanned, pagesScanned, pendingPrefixes }) => {
      console.log(
        `[${SCRIPT_NAME}] Visited ${pagesScanned.toLocaleString()} storage pages, scanned ${filesScanned.toLocaleString()} files, found ${orphanCount.toLocaleString()} orphans${options.execute ? `, deleted ${deletedCount.toLocaleString()}` : ''}, pending prefixes ${pendingPrefixes.toLocaleString()}.`,
      )
    },
  })

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
  console.log(`[${SCRIPT_NAME}] Summary`)
  console.log(
    JSON.stringify(
      {
        projectRef: restConfig.projectRef,
        authMode: 'service-role-rest',
        mode: options.execute ? 'execute' : 'dry-run',
        bucket: BUCKET,
        table: TABLE,
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
    console.log(`[${SCRIPT_NAME}] Sample orphan paths:`)
    for (const row of result.sample) {
      console.log(`- ${row.createdAt} ${row.storagePath}`)
    }
  }

  if (!options.execute) {
    console.log(`[${SCRIPT_NAME}] Dry run only. Re-run with --execute to delete.`)
  }
}

main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed:`, error)
  process.exit(1)
})
