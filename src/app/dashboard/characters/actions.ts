'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getFormDataErrorMessage, safeParseFormData } from '@/lib/form-data'
import { cleanupOrphanedModules, listCharacterModuleIds } from '@/lib/modules/orphan-cleanup'
import { validateModuleOwnership } from '@/lib/modules/ownership'
import { createClient } from '@/lib/supabase/server'

const characterFormSchema = z.object({
  name: z.string().min(1, 'Character name is required.'),
  description: z.string().optional().default(''),
  system_prompt: z.string().min(1, 'System prompt is required.'),
  greeting_message: z.string().optional(),
  module_ids: z.string().optional(),
})

function parseCharacterFormData(formData: FormData) {
  const parsed = safeParseFormData(formData, characterFormSchema)

  if (!parsed.success) {
    return {
      error: getCharacterFormErrorMessage(parsed.error),
    }
  }

  return { data: parsed.data }
}

export async function createCharacter(formData: FormData) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Login required' }
  }

  const parsedForm = parseCharacterFormData(formData)

  if ('error' in parsedForm) {
    return parsedForm
  }

  const requestedModuleIds = parseModuleIds(parsedForm.data.module_ids ?? null)
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
      name: parsedForm.data.name,
      description: parsedForm.data.description,
      system_prompt: parsedForm.data.system_prompt,
      greeting_message: normalizeNullableText(parsedForm.data.greeting_message),
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

  const previousModuleIds = await listCharacterModuleIds(supabase, id).catch((error: Error) => {
    console.error('[Character] Failed to load linked modules before update', {
      characterId: id,
      userId: user.id,
      error: error.message,
    })
    return []
  })

  const parsedForm = parseCharacterFormData(formData)

  if ('error' in parsedForm) {
    return parsedForm
  }

  const requestedModuleIds = parseModuleIds(parsedForm.data.module_ids ?? null)
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
      name: parsedForm.data.name,
      description: parsedForm.data.description,
      system_prompt: parsedForm.data.system_prompt,
      greeting_message: normalizeNullableText(parsedForm.data.greeting_message),
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

  const { error: unlinkError } = await supabase
    .from('character_modules')
    .delete()
    .eq('character_id', id)

  if (unlinkError) {
    console.error('[Character] Failed to clear existing module links during update', {
      characterId: id,
      userId: user.id,
      error: unlinkError.message,
      code: unlinkError.code,
    })
    return { error: 'An error occurred while unlinking existing modules. Please try again later.' }
  }

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

  await cleanupOrphanedModules(supabase, previousModuleIds, {
    action: 'updateCharacter',
    characterId: id,
    userId: user.id,
  })

  revalidatePath('/dashboard/characters')
  revalidatePath(`/dashboard/characters/${id}`)
  revalidatePath('/dashboard/modules')
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

  const previousModuleIds = await listCharacterModuleIds(supabase, id).catch((error: Error) => {
    console.error('[Character] Failed to load linked modules before delete', {
      characterId: id,
      userId: user.id,
      error: error.message,
    })
    return []
  })

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

  await cleanupOrphanedModules(supabase, previousModuleIds, {
    action: 'deleteCharacter',
    characterId: id,
    userId: user.id,
  })

  revalidatePath('/dashboard/characters')
  revalidatePath('/dashboard/modules')
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

function normalizeNullableText(value: string | undefined): string | null {
  return value === undefined ? null : value
}

function getCharacterFormErrorMessage(error: z.ZodError): string {
  const firstIssue = error.issues[0]
  const field = typeof firstIssue?.path[0] === 'string' ? firstIssue.path[0] : null

  if (field === 'name') {
    return 'Character name is required.'
  }

  if (field === 'system_prompt') {
    return 'System prompt is required.'
  }

  return getFormDataErrorMessage(error, 'Invalid character form submission.')
}
