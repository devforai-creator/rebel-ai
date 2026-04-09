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

  return typeof data === 'number' ? data : 0
}
