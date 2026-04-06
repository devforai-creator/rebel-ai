'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database.types'

type ToggleParams = {
  characterId: string
  moduleId: string
  entryKey: string
  entryInsertorder: number
  enabled: boolean
}

type LorebookJsonEntry = {
  key?: string
  insertorder?: number
  alwaysActive?: boolean
} & Record<string, Json | undefined>

export async function updateLorebookEntryAlwaysActive({
  characterId,
  moduleId,
  entryKey,
  entryInsertorder,
  enabled,
}: ToggleParams) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { data: character, error: characterError } = await supabase
    .from('characters')
    .select('id')
    .eq('id', characterId)
    .eq('user_id', user.id)
    .single()

  if (characterError || !character) {
    return { error: 'Character not found' }
  }

  const { data: link, error: linkError } = await supabase
    .from('character_modules')
    .select('id')
    .eq('character_id', characterId)
    .eq('module_id', moduleId)
    .single()

  if (linkError || !link) {
    return { error: 'Module is not linked to this character' }
  }

  const { data: module, error: moduleError } = await supabase
    .from('modules')
    .select('id, lorebook')
    .eq('id', moduleId)
    .eq('user_id', user.id)
    .single()

  if (moduleError || !module) {
    return { error: 'Module not found or unauthorized' }
  }

  const lorebookArray = Array.isArray(module.lorebook)
    ? (module.lorebook as LorebookJsonEntry[])
    : null

  if (!lorebookArray) {
    return { error: 'Module has no lorebook entries to update' }
  }

  let updated = false
  const updatedLorebook = lorebookArray.map((entry) => {
    if (
      entry &&
      typeof entry === 'object' &&
      entry.key === entryKey &&
      Number(entry.insertorder) === Number(entryInsertorder)
    ) {
      updated = true
      return {
        ...entry,
        alwaysActive: enabled,
      }
    }
    return entry
  })

  if (!updated) {
    return { error: 'Lorebook entry not found' }
  }

  const { error: updateError } = await supabase
    .from('modules')
    .update({ lorebook: updatedLorebook })
    .eq('id', moduleId)
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[Lorebook] Failed to update entry', updateError)
    return { error: 'Failed to update lorebook entry' }
  }

  revalidatePath(`/dashboard/characters/${characterId}/lorebook`)
  revalidatePath(`/dashboard/characters/${characterId}`)

  return { success: true }
}
