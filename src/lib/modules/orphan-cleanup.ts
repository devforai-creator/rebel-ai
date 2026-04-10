import { removeStorageObjects } from '@/lib/assets/storage-cleanup'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Supabase = SupabaseClient<Database>

type CleanupContext = {
  action: 'deleteCharacter' | 'updateCharacter'
  characterId: string
  userId: string
}

export async function listCharacterModuleIds(
  supabase: Supabase,
  characterId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('character_modules')
    .select('module_id')
    .eq('character_id', characterId)

  if (error) {
    throw error
  }

  return (data ?? []).map((row) => row.module_id)
}

export async function cleanupOrphanedModules(
  supabase: Supabase,
  moduleIds: string[],
  context: CleanupContext,
): Promise<number> {
  const uniqueIds = Array.from(
    new Set(moduleIds.filter((id) => typeof id === 'string' && id.trim().length > 0)),
  )

  if (uniqueIds.length === 0) {
    return 0
  }

  const storagePathsByModuleId = await listModuleAssetStoragePathsByModuleId(
    supabase,
    uniqueIds,
    context,
  )
  const { data, error } = await supabase.rpc('delete_orphaned_modules', {
    module_ids: uniqueIds,
    requester: context.userId,
  })

  if (error) {
    console.error('[Modules] Failed to clean up orphaned modules', {
      action: context.action,
      characterId: context.characterId,
      userId: context.userId,
      moduleIds: uniqueIds,
      error: error.message,
      code: error.code,
    })
    return 0
  }

  const deletedCount = typeof data === 'number' ? data : 0

  if (deletedCount <= 0 || storagePathsByModuleId.size === 0) {
    return deletedCount
  }

  const remainingModuleIds = await listRemainingModuleIds(supabase, uniqueIds, context)

  if (!remainingModuleIds) {
    return deletedCount
  }

  const deletedStoragePaths = uniqueIds
    .filter((moduleId) => !remainingModuleIds.has(moduleId))
    .flatMap((moduleId) => storagePathsByModuleId.get(moduleId) ?? [])

  try {
    await removeStorageObjects(supabase, 'module-assets', deletedStoragePaths, {
      entityId: context.characterId,
      entityType: 'character',
      operation: `cleanupOrphanedModules:${context.action}`,
    })
  } catch (error) {
    console.error('[Modules] Failed to remove module-assets after orphan cleanup', {
      action: context.action,
      characterId: context.characterId,
      userId: context.userId,
      moduleIds: uniqueIds,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  return deletedCount
}

type ModuleAssetStorageRow = {
  module_id: string
  storage_path: string
}

async function listModuleAssetStoragePathsByModuleId(
  supabase: Supabase,
  moduleIds: string[],
  context: CleanupContext,
): Promise<Map<string, string[]>> {
  try {
    const { data, error } = await supabase
      .from('module_assets')
      .select('module_id, storage_path')
      .in('module_id', moduleIds)

    if (error) {
      throw error
    }

    const pathsByModuleId = new Map<string, string[]>()
    for (const row of (data ?? []) as ModuleAssetStorageRow[]) {
      if (
        typeof row.module_id !== 'string' ||
        row.module_id.length === 0 ||
        typeof row.storage_path !== 'string' ||
        row.storage_path.length === 0
      ) {
        continue
      }

      const existing = pathsByModuleId.get(row.module_id) ?? []
      existing.push(row.storage_path)
      pathsByModuleId.set(row.module_id, existing)
    }

    return pathsByModuleId
  } catch (error) {
    console.error('[Modules] Failed to preload module asset paths before orphan cleanup', {
      action: context.action,
      characterId: context.characterId,
      userId: context.userId,
      moduleIds,
      error: error instanceof Error ? error.message : String(error),
    })
    return new Map()
  }
}

async function listRemainingModuleIds(
  supabase: Supabase,
  moduleIds: string[],
  context: CleanupContext,
): Promise<Set<string> | null> {
  try {
    const { data, error } = await supabase.from('modules').select('id').in('id', moduleIds)

    if (error) {
      throw error
    }

    return new Set(
      (data ?? [])
        .map((row) => row.id)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    )
  } catch (error) {
    console.error('[Modules] Failed to load remaining modules after orphan cleanup', {
      action: context.action,
      characterId: context.characterId,
      userId: context.userId,
      moduleIds,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
