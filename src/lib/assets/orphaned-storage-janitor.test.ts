import { describe, expect, it, vi } from 'vitest'
import {
  runStorageJanitor,
  type StorageJanitorOptions,
} from '@/lib/assets/orphaned-storage-janitor'

type ReferenceRow = { storage_path: string }
type StorageRow = {
  name: string
  id: string | null
  created_at: string | null
}

function createSupabaseMock({
  referencedPaths,
  storageTree,
}: {
  referencedPaths: string[]
  storageTree: Record<string, StorageRow[]>
}) {
  const removeMock = vi.fn(async (paths: string[]) => ({ data: paths, error: null }))
  const listMock = vi.fn(async (prefix: string, options: { limit: number; offset: number }) => {
    const rows = storageTree[prefix] ?? []
    return {
      data: rows.slice(options.offset, options.offset + options.limit),
      error: null,
    }
  })

  return {
    removeMock,
    listMock,
    supabase: {
      from() {
        let cursor: string | null = null
        let limit = Number.POSITIVE_INFINITY

        const query = {
          select() {
            return query
          },
          order() {
            return query
          },
          limit(value: number) {
            limit = value
            return query
          },
          gt(_column: string, value: string) {
            cursor = value
            return query
          },
          then(
            resolve: (value: { data: ReferenceRow[]; error: null }) => unknown,
            reject?: (reason?: unknown) => unknown,
          ) {
            const rows = referencedPaths
              .filter((path) => (cursor ? path > cursor : true))
              .sort()
              .slice(0, limit)
              .map((storage_path) => ({ storage_path }))

            return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
          },
        }

        return query
      },
      storage: {
        from() {
          return {
            list: listMock,
            remove: removeMock,
          }
        },
      },
    },
  }
}

async function runJanitor(
  options: Partial<StorageJanitorOptions> & {
    referencedPaths: string[]
    storageTree: Record<string, StorageRow[]>
  },
) {
  const { referencedPaths, storageTree, ...rest } = options
  const mock = createSupabaseMock({ referencedPaths, storageTree })
  const result = await runStorageJanitor(mock.supabase as never, {
    bucket: 'character-assets',
    table: 'character_assets',
    olderThanDays: 1,
    pageSize: 1000,
    deleteBatchSize: 2,
    sampleSize: 5,
    execute: true,
    now: new Date('2026-04-10T00:00:00.000Z'),
    ...rest,
  })

  return {
    ...mock,
    result,
  }
}

describe('runStorageJanitor', () => {
  it('deletes only orphaned files older than the cutoff', async () => {
    const { removeMock, result } = await runJanitor({
      referencedPaths: ['user-a/character-1/keep.png', 'user-b/character-2/keep-2.png'],
      storageTree: {
        '': [
          { name: 'user-a', id: null, created_at: null },
          { name: 'user-b', id: null, created_at: null },
        ],
        'user-a': [{ name: 'character-1', id: null, created_at: null }],
        'user-a/character-1': [
          { name: 'keep.png', id: '1', created_at: '2026-04-08T00:00:00.000Z' },
          { name: 'orphan-old.png', id: '2', created_at: '2026-04-08T00:00:00.000Z' },
          { name: 'orphan-recent.png', id: '3', created_at: '2026-04-09T12:00:00.000Z' },
        ],
        'user-b': [{ name: 'character-2', id: null, created_at: null }],
        'user-b/character-2': [
          { name: 'keep-2.png', id: '4', created_at: '2026-04-08T00:00:00.000Z' },
        ],
      },
    })

    expect(result).toMatchObject({
      mode: 'execute',
      olderThanIso: '2026-04-09T00:00:00.000Z',
      objectsScanned: 3,
      orphanCount: 1,
      deletedCount: 1,
      reachedDeleteLimit: false,
      sample: [
        {
          storagePath: 'user-a/character-1/orphan-old.png',
          createdAt: '2026-04-08T00:00:00.000Z',
        },
      ],
    })
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith(['user-a/character-1/orphan-old.png'])
  })

  it('stops deleting when maxDelete is reached', async () => {
    const { removeMock, result } = await runJanitor({
      maxDelete: 2,
      referencedPaths: [],
      storageTree: {
        '': [{ name: 'user-a', id: null, created_at: null }],
        'user-a': [{ name: 'character-1', id: null, created_at: null }],
        'user-a/character-1': [
          { name: 'orphan-1.png', id: '1', created_at: '2026-04-08T00:00:00.000Z' },
          { name: 'orphan-2.png', id: '2', created_at: '2026-04-08T00:00:00.000Z' },
          { name: 'orphan-3.png', id: '3', created_at: '2026-04-08T00:00:00.000Z' },
        ],
      },
    })

    expect(result.orphanCount).toBe(3)
    expect(result.deletedCount).toBe(2)
    expect(result.reachedDeleteLimit).toBe(true)
    expect(removeMock).toHaveBeenCalledTimes(1)
    expect(removeMock).toHaveBeenCalledWith([
      'user-a/character-1/orphan-1.png',
      'user-a/character-1/orphan-2.png',
    ])
  })
})
