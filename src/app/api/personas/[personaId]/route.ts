import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

interface RouteContext {
  params: Promise<{ personaId: string }>
}

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 5000

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

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
    }

    const { name, description } = body as {
      name?: unknown
      description?: unknown
    }

    const updateData: {
      name?: string
      description?: string | null
    } = {}

    if (name !== undefined) {
      if (typeof name !== 'string') {
        return NextResponse.json({ error: 'Name must be a string' }, { status: 400 })
      }

      const trimmedName = name.trim()
      if (trimmedName.length === 0) {
        return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      }

      if (trimmedName.length > MAX_NAME_LENGTH) {
        return NextResponse.json(
          { error: `Name must be ${MAX_NAME_LENGTH} characters or less` },
          { status: 400 },
        )
      }

      updateData.name = trimmedName
    }

    if (description !== undefined) {
      if (description === null) {
        updateData.description = null
      } else if (typeof description === 'string') {
        const trimmed = description.trim()

        if (trimmed.length > MAX_DESCRIPTION_LENGTH) {
          return NextResponse.json(
            { error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or less` },
            { status: 400 },
          )
        }

        // Empty strings are treated as null to satisfy DB constraint (>= 1 char when not null)
        updateData.description = trimmed.length > 0 ? trimmed : null
      } else {
        return NextResponse.json({ error: 'Description must be a string or null' }, { status: 400 })
      }
    }

    if (!('name' in updateData) && !('description' in updateData)) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
