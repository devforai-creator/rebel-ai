import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import type { Database, PersonaUpdate } from '@/types/database.types'
import { ACTIVE_QUEUE_JOB_STATUSES } from '@/lib/queue/admission'
import { MAX_PERSONA_DESCRIPTION_LENGTH, MAX_PERSONA_NAME_LENGTH } from './constants'

type Supabase = SupabaseClient<Database>

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

export const ACTIVE_PERSONA_MUTATION_CONFLICT_MESSAGE =
  'Wait for active chat responses to finish before changing this persona.'

export async function verifyPersonaNotUsedByActiveChat({
  supabase,
  userId,
  personaId,
}: {
  supabase: Supabase
  userId: string
  personaId: string
}): Promise<{ success: true } | { success: false; status: 409 | 500; message: string }> {
  const { data: chats, error: chatsError } = await supabase
    .from('chats')
    .select('id')
    .eq('user_id', userId)
    .eq('persona_id', personaId)

  if (chatsError) {
    console.error('[Persona Update] Failed to load linked chats', {
      userId,
      personaId,
      message: chatsError.message,
      code: chatsError.code,
    })
    return {
      success: false,
      status: 500,
      message: 'Failed to check active chats',
    }
  }

  const chatIds = (chats ?? []).map((chat) => chat.id)

  if (chatIds.length === 0) {
    return { success: true }
  }

  const { data: activeJobs, error: activeJobsError } = await supabase
    .from('chat_generation_jobs')
    .select('id')
    .eq('user_id', userId)
    .in('chat_id', chatIds)
    .in('status', [...ACTIVE_QUEUE_JOB_STATUSES])
    .limit(1)

  if (activeJobsError) {
    console.error('[Persona Update] Failed to check active chat jobs', {
      userId,
      personaId,
      message: activeJobsError.message,
      code: activeJobsError.code,
    })
    return {
      success: false,
      status: 500,
      message: 'Failed to check active chats',
    }
  }

  if ((activeJobs ?? []).length > 0) {
    return {
      success: false,
      status: 409,
      message: ACTIVE_PERSONA_MUTATION_CONFLICT_MESSAGE,
    }
  }

  return { success: true }
}

export async function verifyOwnedPersona({
  supabase,
  userId,
  personaId,
}: {
  supabase: Supabase
  userId: string
  personaId: string
}): Promise<{ success: true } | { success: false; status: 404 | 500; message: string }> {
  const { data, error } = await supabase
    .from('personas')
    .select('id')
    .eq('id', personaId)
    .eq('user_id', userId)

  if (error) {
    console.error('[Persona Update] Failed to verify ownership', {
      userId,
      personaId,
      message: error.message,
      code: error.code,
    })
    return {
      success: false,
      status: 500,
      message: 'Failed to load persona',
    }
  }

  if (!Array.isArray(data) || data.length === 0) {
    return {
      success: false,
      status: 404,
      message: 'Persona not found',
    }
  }

  return { success: true }
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
  | { success: false; status: 404 | 409 | 500; message: string }
> {
  const ownership = await verifyOwnedPersona({
    supabase,
    userId,
    personaId,
  })

  if (!ownership.success) {
    return ownership
  }

  const activeUse = await verifyPersonaNotUsedByActiveChat({
    supabase,
    userId,
    personaId,
  })

  if (!activeUse.success) {
    return activeUse
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
