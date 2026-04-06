import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'

type Supabase = SupabaseClient<Database>

/**
 * Verify that every requested module belongs to the current user.
 * Returns the ordered list of valid module IDs and any invalid IDs that were rejected.
 */
export async function validateModuleOwnership(
  supabase: Supabase,
  userId: string,
  moduleIds: string[],
): Promise<{ validIds: string[]; invalidIds: string[] }> {
  const uniqueIds = Array.from(
    new Set(moduleIds.filter((id) => typeof id === 'string' && id.trim().length > 0)),
  )

  if (uniqueIds.length === 0) {
    return { validIds: [], invalidIds: [] }
  }

  const { data, error } = await supabase
    .from('modules')
    .select('id')
    .eq('user_id', userId)
    .in('id', uniqueIds)

  if (error) {
    console.error('[Module Ownership] Failed to verify modules', {
      userId,
      error: error.message,
    })
    throw new Error('모듈 소유권을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.')
  }

  type ModuleRow = { id: string }
  const moduleRows: ModuleRow[] = (data ?? []) as ModuleRow[]
  const ownedSet = new Set(moduleRows.map((row) => row.id))
  const validIds = uniqueIds.filter((id) => ownedSet.has(id))
  const invalidIds = uniqueIds.filter((id) => !ownedSet.has(id))

  return { validIds, invalidIds }
}
