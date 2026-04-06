'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { PersonaInsert, PersonaUpdate } from '@/types/database.types'

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

  // Validate input
  if (data.name !== undefined) {
    if (data.name.trim().length === 0) {
      return { error: 'Persona name cannot be empty' }
    }
    if (data.name.length > 100) {
      return { error: 'Persona name must be 100 characters or less' }
    }
  }

  if (data.description !== undefined) {
    if (data.description !== null && data.description.length > 5000) {
      return { error: 'Persona description must be 5000 characters or less' }
    }
  }

  const updateData: PersonaUpdate = {}
  if (data.name !== undefined) updateData.name = data.name.trim()
  if (data.description !== undefined) {
    updateData.description = data.description ? data.description.trim() : null
  }

  const { data: persona, error } = await supabase
    .from('personas')
    .update(updateData)
    .eq('id', personaId)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/dashboard/personas')
  return { persona }
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
