import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createApiErrorResponse, parseJsonRequest } from '@/lib/http/api-contract'
import { z } from 'zod'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ personaId: string }>
}

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 5000

const personaUpdateSchema = z
  .object({
    name: z
      .string({ error: 'Name must be a string' })
      .transform((value) => value.trim())
      .refine((value) => value.length > 0, 'Name cannot be empty')
      .refine(
        (value) => value.length <= MAX_NAME_LENGTH,
        `Name must be ${MAX_NAME_LENGTH} characters or less`,
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
        (value) => value === null || value.length <= MAX_DESCRIPTION_LENGTH,
        `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less`,
      )
      .optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'Nothing to update',
  })

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { personaId } = await context.params
    const supabase = await createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Validate ownership first
    const { data: existingPersona } = await supabase
      .from('personas')
      .select('id')
      .eq('id', personaId)
      .eq('user_id', user.id)
      .single()

    if (!existingPersona) {
      return NextResponse.json({ error: 'Persona not found' }, { status: 404 })
    }

    const parsed = await parseJsonRequest(request, personaUpdateSchema, {
      invalidBodyMessage: (error) => error.issues[0]?.message ?? 'Invalid payload',
    })
    if (!parsed.success) {
      return parsed.response
    }
    const { name, description } = parsed.data

    const updateData: {
      name?: string
      description?: string | null
    } = {}

    if (name !== undefined) {
      updateData.name = name
    }

    if (description !== undefined) {
      updateData.description = description
    }

    const { data: persona, error: updateError } = await supabase
      .from('personas')
      .update(updateData)
      .eq('id', personaId)
      .eq('user_id', user.id)
      .select('id, name, description')
      .single()

    if (updateError) {
      console.error('[Persona API] Failed to update persona', {
        userId: user.id,
        personaId,
        message: updateError.message,
      })
      return NextResponse.json({ error: 'Failed to update persona' }, { status: 500 })
    }

    return NextResponse.json({ persona })
  } catch (error) {
    console.error('[Persona API] Unexpected error', error)
    return createApiErrorResponse('Internal server error', 500)
  }
}
