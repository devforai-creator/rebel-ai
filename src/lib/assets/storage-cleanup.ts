import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Supabase = Pick<SupabaseClient<Database>, 'from' | 'storage'>

const STORAGE_REMOVE_CHUNK_SIZE = 100

type StorageCleanupContext = {
  entityId: string
  entityType: 'character' | 'import'
  operation: string
}

export async function listCharacterAssetStoragePaths(
  supabase: Pick<SupabaseClient<Database>, 'from'>,
  characterId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('character_assets')
    .select('storage_path')
    .eq('character_id', characterId)

  if (error) {
    throw error
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((row) => row.storage_path)
        .filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  )
}

export async function removeStorageObjects(
  supabase: Supabase,
  bucket: string,
  storagePaths: string[],
  context: StorageCleanupContext,
): Promise<void> {
  const uniquePaths = Array.from(
    new Set(storagePaths.filter((value) => typeof value === 'string' && value.length > 0)),
  )

  if (uniquePaths.length === 0) {
    return
  }

  for (let index = 0; index < uniquePaths.length; index += STORAGE_REMOVE_CHUNK_SIZE) {
    const chunk = uniquePaths.slice(index, index + STORAGE_REMOVE_CHUNK_SIZE)
    const { error } = await supabase.storage.from(bucket).remove(chunk)

    if (error) {
      console.error('[Storage Cleanup] Failed to remove objects', {
        bucket,
        entityId: context.entityId,
        entityType: context.entityType,
        operation: context.operation,
        pathCount: chunk.length,
        error: error.message,
      })
      return
    }
  }
}
