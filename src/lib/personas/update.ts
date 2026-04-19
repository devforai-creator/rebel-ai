import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database, PersonaUpdate } from '@/types/database.types'

type Supabase = SupabaseClient<Database>

export const MAX_PERSONA_NAME_LENGTH = 100
export const MAX_PERSONA_DESCRIPTION_LENGTH = 5000

export const personaUpdateSchema = z
  .object({
    name: z
      .string({ error: 'Name must be a string' })
      .transform((value) => value.trim())
      .refine((value) => value.length > 0, 'Name cannot be empty')
      .refine(
        (value) => value.length <= MAX_PERSONA_NAME_LENGTH,
        `Name must be ${MAX_PERSONA_NAME_LENGTH} characters or less`,
      )
      .optional(),
    description: z
      .union([z.string(), z.null()], {
        error: 'Description must be a string or null',
      })
      .transform((value) => {
        if (value === null) {
          return null
        }

        const trimmed = value.trim()
        return trimmed.length > 0 ? trimmed : null
      })
      .refine(
        (value) => value === null || value.length <= MAX_PERSONA_DESCRIPTION_LENGTH,
        `Description must be ${MAX_PERSONA_DESCRIPTION_LENGTH} characters or less`,
      )
      .optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'Nothing to update',
  })

export type PersonaUpdateInput = z.input<typeof personaUpdateSchema>
export type NormalizedPersonaUpdateInput = z.output<typeof personaUpdateSchema>
export type UpdatedPersona = {
  id: string
  name: string
  description: string | null
}

export function getPersonaUpdateValidationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Invalid payload'
}

export function parsePersonaUpdateInput(input: unknown) {
  return personaUpdateSchema.safeParse(input)
}

export async function updateOwnedPersona({
  supabase,
  userId,
  personaId,
  input,
}: {
  supabase: Supabase
  userId: string
  personaId: string
  input: NormalizedPersonaUpdateInput
}): Promise<
  | { success: true; persona: UpdatedPersona }
  | { success: false; status: 404 | 500; message: string }
> {
  const { data: existingPersona } = await supabase
    .from('personas')
    .select('id')
    .eq('id', personaId)
    .eq('user_id', userId)
    .single()

  if (!existingPersona) {
    return {
      success: false,
      status: 404,
      message: 'Persona not found',
    }
  }

  const updateData: PersonaUpdate = {}

  if (input.name !== undefined) {
    updateData.name = input.name
  }

  if (input.description !== undefined) {
    updateData.description = input.description
  }

  const { data: persona, error: updateError } = await supabase
    .from('personas')
    .update(updateData)
    .eq('id', personaId)
    .eq('user_id', userId)
    .select('id, name, description')
    .single<UpdatedPersona>()

  if (updateError || !persona) {
    console.error('[Persona Update] Failed to update persona', {
      userId,
      personaId,
      message: updateError?.message ?? 'Unknown error',
    })
    return {
      success: false,
      status: 500,
      message: 'Failed to update persona',
    }
  }

  return {
    success: true,
    persona,
  }
}
