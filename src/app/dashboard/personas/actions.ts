'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PersonaInsert } from '@/types/database.types'
import { MAX_PERSONA_DESCRIPTION_LENGTH, MAX_PERSONA_NAME_LENGTH } from '@/lib/personas/constants'
import {
  parsePersonaUpdateInput,
  updateOwnedPersona,
  verifyOwnedPersona,
} from '@/lib/personas/update'

/**
 * Get all personas for the current user
 */
export async function getPersonas() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const { data: personas, error } = await supabase
    .from('personas')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    return { error: error.message }
  }

  return { personas }
}

/**
 * Create a new persona
 */
export async function createPersona(data: { name: string; description?: string }) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  // Validate input
  const trimmedName = data.name.trim()
  const trimmedDescription = data.description?.trim()

  if (!trimmedName) {
    return { error: 'Persona name is required' }
  }

  if (trimmedName.length > MAX_PERSONA_NAME_LENGTH) {
    return { error: `Persona name must be ${MAX_PERSONA_NAME_LENGTH} characters or less` }
  }

  if (trimmedDescription && trimmedDescription.length > MAX_PERSONA_DESCRIPTION_LENGTH) {
    return {
      error: `Persona description must be ${MAX_PERSONA_DESCRIPTION_LENGTH} characters or less`,
    }
  }

  const personaData: PersonaInsert = {
    user_id: user.id,
    name: trimmedName,
    description: trimmedDescription || null,
  }

  const { data: persona, error } = await supabase
    .from('personas')
    .insert(personaData)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/personas')
  return { persona }
}

/**
 * Update an existing persona
 */
export async function updatePersona(
  personaId: string,
  data: {
    name?: string
    description?: string | null
  },
) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const parsed = parsePersonaUpdateInput(data)

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? 'Invalid payload',
    }
  }

  const result = await updateOwnedPersona({
    supabase,
    userId: user.id,
    personaId,
    input: parsed.data,
  })

  if (!result.success) {
    return { error: result.message }
  }

  revalidatePath('/dashboard/personas')
  return { persona: result.persona }
}

/**
 * Delete a persona
 */
export async function deletePersona(personaId: string) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: 'Unauthorized' }
  }

  const ownership = await verifyOwnedPersona({
    supabase,
    userId: user.id,
    personaId,
  })

  if (!ownership.success) {
    return {
      error:
        ownership.status === 404
          ? 'Persona not found or you do not have permission'
          : 'Failed to load persona. Please try again.',
    }
  }

  const { error } = await supabase
    .from('personas')
    .delete()
    .eq('id', personaId)
    .eq('user_id', user.id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/personas')
  return { success: true }
}
