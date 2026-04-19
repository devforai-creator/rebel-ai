import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createApiErrorResponse, parseJsonRequest } from '@/lib/http/api-contract'
import {
  getPersonaUpdateValidationMessage,
  personaUpdateSchema,
  updateOwnedPersona,
} from '@/lib/personas/update'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ personaId: string }>
}

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

    const parsed = await parseJsonRequest(request, personaUpdateSchema, {
      invalidBodyMessage: getPersonaUpdateValidationMessage,
    })
    if (!parsed.success) {
      return parsed.response
    }

    const result = await updateOwnedPersona({
      supabase,
      userId: user.id,
      personaId,
      input: parsed.data,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: result.status })
    }

    return NextResponse.json({ persona: result.persona })
  } catch (error) {
    console.error('[Persona API] Unexpected error', error)
    return createApiErrorResponse('Internal server error', 500)
  }
}
