'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { validateModuleOwnership } from '@/lib/modules/ownership'
import { createClient } from '@/lib/supabase/server'

export async function createCharacter(formData: FormData) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required' }
  }

  const requestedModuleIds = parseModuleIds(formData.get('module_ids') as string | null)
  let authorizedModuleIds: string[] = []

  if (requestedModuleIds.length > 0) {
    const { validIds, invalidIds } = await validateModuleOwnership(
      supabase,
      user.id,
      requestedModuleIds,
    )

    if (invalidIds.length > 0) {
      return { error: 'You do not have permission for some of the selected modules.' }
    }

    authorizedModuleIds = validIds
  }

  const { data: character, error } = await supabase
    .from('characters')
    .insert({
      user_id: user.id,
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      system_prompt: formData.get('system_prompt') as string,
      greeting_message: formData.get('greeting_message') as string,
      visibility: 'private',
    })
    .select()
    .single()

  if (error) {
    console.error('[Character] Failed to create character', {
      userId: user.id,
      error: error.message,
      code: error.code,
    })
    return { error: 'Failed to create character. Please try again.' }
  }

  if (authorizedModuleIds.length > 0) {
    const rows = authorizedModuleIds.map((moduleId, index) => ({
      character_id: character.id,
      module_id: moduleId,
      enabled: true,
      priority: authorizedModuleIds.length - index,
    }))

    const { error: moduleLinkError } = await supabase.from('character_modules').insert(rows)

    if (moduleLinkError) {
      console.error('[Character] Failed to link modules during creation', {
        characterId: character.id,
        moduleIds: authorizedModuleIds,
        error: moduleLinkError.message,
      })
      await supabase.from('characters').delete().eq('id', character.id)
      return { error: 'Failed to link modules. Please try again.' }
    }
  }

  revalidatePath('/dashboard/characters')
  redirect(`/dashboard/characters/${character.id}`)
}

export async function updateCharacter(id: string, formData: FormData) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required' }
  }

  const requestedModuleIds = parseModuleIds(formData.get('module_ids') as string | null)
  let authorizedModuleIds: string[] = []

  if (requestedModuleIds.length > 0) {
    const { validIds, invalidIds } = await validateModuleOwnership(
      supabase,
      user.id,
      requestedModuleIds,
    )

    if (invalidIds.length > 0) {
      return { error: 'You do not have permission for some of the selected modules.' }
    }

    authorizedModuleIds = validIds
  }

  const { error } = await supabase
    .from('characters')
    .update({
      name: formData.get('name') as string,
      description: formData.get('description') as string,
      system_prompt: formData.get('system_prompt') as string,
      greeting_message: formData.get('greeting_message') as string,
    })
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) {
    console.error('[Character] Failed to update character', {
      characterId: id,
      userId: user.id,
      error: error.message,
      code: error.code,
    })
    return { error: 'Failed to update character. Please try again.' }
  }

  await supabase.from('character_modules').delete().eq('character_id', id)

  if (authorizedModuleIds.length > 0) {
    const rows = authorizedModuleIds.map((moduleId, index) => ({
      character_id: id,
      module_id: moduleId,
      enabled: true,
      priority: authorizedModuleIds.length - index,
    }))

    const { error: moduleInsertError } = await supabase.from('character_modules').insert(rows)

    if (moduleInsertError) {
      console.error('[Character] Failed to link modules during update', {
        characterId: id,
        error: moduleInsertError.message,
      })
      return { error: 'An error occurred while linking modules. Please try again later.' }
    }
  }

  revalidatePath('/dashboard/characters')
  revalidatePath(`/dashboard/characters/${id}`)
  redirect(`/dashboard/characters/${id}`)
}

export async function deleteCharacter(id: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required' }
  }

  const { error } = await supabase.from('characters').delete().eq('id', id).eq('user_id', user.id)

  if (error) {
    console.error('[Character] Failed to delete character', {
      characterId: id,
      userId: user.id,
      error: error.message,
      code: error.code,
    })
    return { error: 'Failed to delete character. Please try again.' }
  }

  revalidatePath('/dashboard/characters')
  return { success: true }
}

function parseModuleIds(raw: string | null): string[] {
  if (!raw) {
    return []
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function normalizeOptionalFormString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
