'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PersonaInsert } from '@/types/database.types'
import { parsePersonaUpdateInput, updateOwnedPersona } from '@/lib/personas/update'

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
  if (!data.name || data.name.trim().length === 0) {
    return { error: 'Persona name is required' }
  }

  if (data.name.length > 100) {
    return { error: 'Persona name must be 100 characters or less' }
  }

  if (data.description && data.description.length > 5000) {
    return { error: 'Persona description must be 5000 characters or less' }
  }

  const personaData: PersonaInsert = {
    user_id: user.id,
    name: data.name.trim(),
    description: data.description ? data.description.trim() : null,
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

  // Verify ownership
  const { data: existing } = await supabase
    .from('personas')
    .select('id')
    .eq('id', personaId)
    .eq('user_id', user.id)
    .single()

  if (!existing) {
    return { error: 'Persona not found or you do not have permission' }
  }

  const { error } = await supabase.from('personas').delete().eq('id', personaId)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/personas')
  return { success: true }
}
