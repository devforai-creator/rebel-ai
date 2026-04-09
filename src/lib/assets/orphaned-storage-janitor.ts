import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type AssetTable = 'character_assets' | 'module_assets'
type AssetBucket = 'character-assets' | 'module-assets'

type Supabase = Pick<SupabaseClient<Database>, 'from' | 'storage'>

type StorageListRow = {
  name: string
  id: string | null
  created_at: string | null
}

export type StorageJanitorOptions = {
  bucket: AssetBucket
  table: AssetTable
  olderThanDays?: number
  pageSize?: number
  deleteBatchSize?: number
  sampleSize?: number
  maxDelete?: number | null
  execute?: boolean
  now?: Date
}

export type StorageJanitorSummary = {
  bucket: AssetBucket
  table: AssetTable
  mode: 'dry-run' | 'execute'
  olderThanIso: string | null
  objectsScanned: number
  orphanCount: number
  deletedCount: number
  reachedDeleteLimit: boolean
  sample: Array<{
    storagePath: string
    createdAt: string | null
  }>
}

const DEFAULT_PAGE_SIZE = 1000
const DEFAULT_DELETE_BATCH_SIZE = 100
const DEFAULT_SAMPLE_SIZE = 20

export async function runStorageJanitor(
  supabase: Supabase,
  options: StorageJanitorOptions,
): Promise<StorageJanitorSummary> {
  const execute = options.execute ?? false
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const deleteBatchSize = options.deleteBatchSize ?? DEFAULT_DELETE_BATCH_SIZE
  const sampleSize = options.sampleSize ?? DEFAULT_SAMPLE_SIZE
  const olderThanIso = buildOlderThanIso(options.olderThanDays, options.now)
  const referencedPaths = await loadReferencedStoragePaths(supabase, options.table, pageSize)

  const sample: Array<{ storagePath: string; createdAt: string | null }> = []
  const deleteBuffer: string[] = []

  let objectsScanned = 0
  let orphanCount = 0
  let deletedCount = 0
  let reachedDeleteLimit = false

  await walkStorageObjects(supabase, options.bucket, pageSize, async (row) => {
    if (olderThanIso && (!row.created_at || row.created_at >= olderThanIso)) {
      return true
    }

    objectsScanned += 1

    const storagePath = row.storagePath
    if (referencedPaths.has(storagePath)) {
      return true
    }

    orphanCount += 1

    if (sample.length < sampleSize) {
      sample.push({
        storagePath,
        createdAt: row.created_at,
      })
    }

    if (!execute) {
      return true
    }

    if (options.maxDelete && deletedCount + deleteBuffer.length >= options.maxDelete) {
      reachedDeleteLimit = true
      return false
    }

    deleteBuffer.push(storagePath)

    if (deleteBuffer.length >= deleteBatchSize) {
      deletedCount += await deleteStoragePaths(
        supabase,
        options.bucket,
        deleteBuffer.splice(0, deleteBuffer.length),
      )
    }

    return true
  })

  if (execute && deleteBuffer.length > 0) {
    deletedCount += await deleteStoragePaths(
      supabase,
      options.bucket,
      deleteBuffer.splice(0, deleteBuffer.length),
    )
  }

  return {
    bucket: options.bucket,
    table: options.table,
    mode: execute ? 'execute' : 'dry-run',
    olderThanIso,
    objectsScanned,
    orphanCount,
    deletedCount,
    reachedDeleteLimit,
    sample,
  }
}

function buildOlderThanIso(
  olderThanDays: number | undefined,
  now: Date | undefined,
): string | null {
  if (!olderThanDays) {
    return null
  }

  const currentTimeMs = now?.getTime() ?? Date.now()
  return new Date(currentTimeMs - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
}

async function loadReferencedStoragePaths(
  supabase: Pick<SupabaseClient<Database>, 'from'>,
  table: AssetTable,
  pageSize: number,
): Promise<Set<string>> {
  const pathSet = new Set<string>()
  let cursor: string | null = null

  while (true) {
    let query = supabase
      .from(table)
      .select('storage_path')
      .order('storage_path', { ascending: true })
      .limit(pageSize)

    if (cursor) {
      query = query.gt('storage_path', cursor)
    }

    const { data, error } = await query

    if (error) {
      throw error
    }

    const rows = data ?? []
    if (rows.length === 0) {
      break
    }

    for (const row of rows) {
      if (typeof row.storage_path === 'string' && row.storage_path.length > 0) {
        pathSet.add(row.storage_path)
      }
    }

    cursor = rows[rows.length - 1]?.storage_path ?? null
  }

  return pathSet
}

async function walkStorageObjects(
  supabase: Pick<SupabaseClient<Database>, 'storage'>,
  bucket: AssetBucket,
  pageSize: number,
  visitFile: (row: StorageListRow & { storagePath: string }) => Promise<boolean>,
): Promise<void> {
  const storage = supabase.storage.from(bucket)
  const prefixes = ['']

  while (prefixes.length > 0) {
    const prefix = prefixes.pop() ?? ''
    let offset = 0

    while (true) {
      const { data, error } = await storage.list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      })

      if (error) {
        throw error
      }

      const rows = (data ?? []) as StorageListRow[]
      if (rows.length === 0) {
        break
      }

      for (const row of rows) {
        const storagePath = prefix ? `${prefix}/${row.name}` : row.name

        if (row.id === null) {
          prefixes.push(storagePath)
          continue
        }

        const shouldContinue = await visitFile({
          ...row,
          storagePath,
        })

        if (!shouldContinue) {
          return
        }
      }

      if (rows.length < pageSize) {
        break
      }

      offset += rows.length
    }
  }
}

async function deleteStoragePaths(
  supabase: Pick<SupabaseClient<Database>, 'storage'>,
  bucket: AssetBucket,
  storagePaths: string[],
): Promise<number> {
  const uniquePaths = Array.from(
    new Set(storagePaths.filter((value) => typeof value === 'string' && value.length > 0)),
  )

  if (uniquePaths.length === 0) {
    return 0
  }

  const { error } = await supabase.storage.from(bucket).remove(uniquePaths)
  if (error) {
    throw error
  }

  return uniquePaths.length
}
