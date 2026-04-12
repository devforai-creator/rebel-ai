import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupOrphanedModules, listCharacterModuleIds } from './orphan-cleanup'

const removeStorageObjectsMock = vi.fn()

vi.mock('@/lib/assets/storage-cleanup', () => ({
  removeStorageObjects: (...args: unknown[]) => removeStorageObjectsMock(...args),
}))

type QueryResult = Promise<{
  data: Record<string, unknown>[] | null
  error: Error | { message: string; code?: string | null } | null
}>

function createEqQuery(result: QueryResult) {
  return {
    eq: vi.fn(() => result),
  }
}

function createInQuery(result: QueryResult) {
  return {
    in: vi.fn(() => result),
  }
}

function createSupabaseMock(options: {
  characterModulesResult?: QueryResult
  moduleAssetsResult?: QueryResult
  modulesResult?: QueryResult
  rpcResult?: Promise<{
    data: unknown
    error: { message: string; code?: string | null } | null
  }>
}) {
  const characterModulesResult =
    options.characterModulesResult ?? Promise.resolve({ data: [], error: null })
  const moduleAssetsResult =
    options.moduleAssetsResult ?? Promise.resolve({ data: [], error: null })
  const modulesResult = options.modulesResult ?? Promise.resolve({ data: [], error: null })
  const rpcResult = options.rpcResult ?? Promise.resolve({ data: 0, error: null })

  return {
    from: vi.fn((table: string) => {
      switch (table) {
        case 'character_modules':
          return {
            select: vi.fn(() => createEqQuery(characterModulesResult)),
          }
        case 'module_assets':
          return {
            select: vi.fn(() => createInQuery(moduleAssetsResult)),
          }
        case 'modules':
          return {
            select: vi.fn(() => createInQuery(modulesResult)),
          }
        default:
          throw new Error(`Unexpected table: ${table}`)
      }
    }),
    rpc: vi.fn(async () => rpcResult),
  }
}

const context = {
  action: 'deleteCharacter' as const,
  characterId: 'char-1',
  userId: 'user-1',
}

describe('orphan-cleanup', () => {
  beforeEach(() => {
    removeStorageObjectsMock.mockReset()
    vi.restoreAllMocks()
  })

  it('loads character module ids and throws when the query fails', async () => {
    const successSupabase = createSupabaseMock({
      characterModulesResult: Promise.resolve({
        data: [{ module_id: 'module-1' }, { module_id: 'module-2' }],
        error: null,
      }),
    })

    await expect(listCharacterModuleIds(successSupabase as never, 'char-1')).resolves.toEqual([
      'module-1',
      'module-2',
    ])

    const failingSupabase = createSupabaseMock({
      characterModulesResult: Promise.resolve({
        data: null,
        error: { message: 'load failed', code: 'XX000' },
      }),
    })

    await expect(listCharacterModuleIds(failingSupabase as never, 'char-1')).rejects.toMatchObject({
      message: 'load failed',
      code: 'XX000',
    })
  })

  it('deduplicates module ids and removes assets only for modules actually deleted', async () => {
    const supabase = createSupabaseMock({
      moduleAssetsResult: Promise.resolve({
        data: [
          { module_id: 'module-1', storage_path: 'module-1/a.png' },
          { module_id: 'module-1', storage_path: 'module-1/b.png' },
          { module_id: 'module-2', storage_path: 'module-2/keep.png' },
          { module_id: '', storage_path: 'skip-empty-module.png' },
          { module_id: 'module-1', storage_path: '' },
        ],
        error: null,
      }),
      modulesResult: Promise.resolve({
        data: [{ id: 'module-2' }],
        error: null,
      }),
      rpcResult: Promise.resolve({ data: 2, error: null }),
    })

    const deletedCount = await cleanupOrphanedModules(
      supabase as never,
      ['module-1', 'module-1', '   ', 'module-2'],
      context,
    )

    expect(deletedCount).toBe(2)
    expect(supabase.rpc).toHaveBeenCalledWith('delete_orphaned_modules', {
      module_ids: ['module-1', 'module-2'],
      requester: 'user-1',
    })
    expect(removeStorageObjectsMock).toHaveBeenCalledWith(
      supabase,
      'module-assets',
      ['module-1/a.png', 'module-1/b.png'],
      {
        entityId: 'char-1',
        entityType: 'character',
        operation: 'cleanupOrphanedModules:deleteCharacter',
      },
    )
  })

  it('returns the deleted count when preloading asset paths fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = createSupabaseMock({
      moduleAssetsResult: Promise.resolve({
        data: null,
        error: new Error('module asset lookup failed'),
      }),
      rpcResult: Promise.resolve({ data: 3, error: null }),
    })

    await expect(cleanupOrphanedModules(supabase as never, ['module-1'], context)).resolves.toBe(3)

    expect(removeStorageObjectsMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      '[Modules] Failed to preload module asset paths before orphan cleanup',
      expect.objectContaining({
        action: 'deleteCharacter',
        characterId: 'char-1',
        userId: 'user-1',
        moduleIds: ['module-1'],
        error: 'module asset lookup failed',
      }),
    )
  })

  it('returns zero when the orphan cleanup rpc fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = createSupabaseMock({
      rpcResult: Promise.resolve({
        data: null,
        error: { message: 'rpc failed', code: 'P0001' },
      }),
    })

    await expect(cleanupOrphanedModules(supabase as never, ['module-1'], context)).resolves.toBe(0)

    expect(removeStorageObjectsMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      '[Modules] Failed to clean up orphaned modules',
      expect.objectContaining({
        action: 'deleteCharacter',
        characterId: 'char-1',
        userId: 'user-1',
        moduleIds: ['module-1'],
        error: 'rpc failed',
        code: 'P0001',
      }),
    )
  })

  it('returns the deleted count when the remaining-module lookup fails after cleanup', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = createSupabaseMock({
      moduleAssetsResult: Promise.resolve({
        data: [{ module_id: 'module-1', storage_path: 'module-1/a.png' }],
        error: null,
      }),
      modulesResult: Promise.resolve({
        data: null,
        error: new Error('module existence lookup failed'),
      }),
      rpcResult: Promise.resolve({ data: 1, error: null }),
    })

    await expect(cleanupOrphanedModules(supabase as never, ['module-1'], context)).resolves.toBe(1)

    expect(removeStorageObjectsMock).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith(
      '[Modules] Failed to load remaining modules after orphan cleanup',
      expect.objectContaining({
        action: 'deleteCharacter',
        characterId: 'char-1',
        userId: 'user-1',
        moduleIds: ['module-1'],
        error: 'module existence lookup failed',
      }),
    )
  })

  it('logs storage cleanup failures without masking the orphan-delete result', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const supabase = createSupabaseMock({
      moduleAssetsResult: Promise.resolve({
        data: [{ module_id: 'module-1', storage_path: 'module-1/a.png' }],
        error: null,
      }),
      modulesResult: Promise.resolve({
        data: [],
        error: null,
      }),
      rpcResult: Promise.resolve({ data: 1, error: null }),
    })
    removeStorageObjectsMock.mockRejectedValueOnce(new Error('bucket remove failed'))

    await expect(cleanupOrphanedModules(supabase as never, ['module-1'], context)).resolves.toBe(1)

    expect(errorSpy).toHaveBeenCalledWith(
      '[Modules] Failed to remove module-assets after orphan cleanup',
      expect.objectContaining({
        action: 'deleteCharacter',
        characterId: 'char-1',
        userId: 'user-1',
        moduleIds: ['module-1'],
        error: 'bucket remove failed',
      }),
    )
  })
})
