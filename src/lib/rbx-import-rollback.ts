import { removeStorageObjects } from '@/lib/assets/storage-cleanup'
import type { ImportRbxSupabaseClient } from './rbx-import-assets'

export interface CreatedModule {
  id: string
  uploadedAssetPaths: string[]
}

export async function rollbackImportFailure({
  supabase,
  characterId,
  createdModules,
  uploadedCharacterAssetPaths,
}: {
  supabase: ImportRbxSupabaseClient
  characterId?: string
  createdModules: CreatedModule[]
  uploadedCharacterAssetPaths: string[]
}): Promise<void> {
  let characterDeleted = false
  if (characterId) {
    console.error('[RBX Importer] Rolling back character creation:', characterId)
    const { error: deleteCharacterError } = await supabase
      .from('characters')
      .delete()
      .eq('id', characterId)
    characterDeleted = !deleteCharacterError
  }

  if (characterDeleted && uploadedCharacterAssetPaths.length > 0 && characterId) {
    try {
      await removeStorageObjects(supabase, 'character-assets', uploadedCharacterAssetPaths, {
        entityId: characterId,
        entityType: 'import',
        operation: 'rollbackImport',
      })
    } catch (rollbackCleanupError) {
      console.error('[RBX Importer] Failed to remove character-assets during rollback', {
        characterId,
        error:
          rollbackCleanupError instanceof Error
            ? rollbackCleanupError.message
            : String(rollbackCleanupError),
      })
    }
  }

  for (const createdModule of createdModules) {
    console.error('[RBX Importer] Rolling back orphaned module:', createdModule.id)
    const { error: deleteModuleError } = await supabase
      .from('modules')
      .delete()
      .eq('id', createdModule.id)

    if (!deleteModuleError && createdModule.uploadedAssetPaths.length > 0) {
      try {
        await removeStorageObjects(supabase, 'module-assets', createdModule.uploadedAssetPaths, {
          entityId: createdModule.id,
          entityType: 'module',
          operation: 'rollbackImport',
        })
      } catch (rollbackCleanupError) {
        console.error('[RBX Importer] Failed to remove module-assets during rollback', {
          moduleId: createdModule.id,
          error:
            rollbackCleanupError instanceof Error
              ? rollbackCleanupError.message
              : String(rollbackCleanupError),
        })
      }
    }
  }
}
