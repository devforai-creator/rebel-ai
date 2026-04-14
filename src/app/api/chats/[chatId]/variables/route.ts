/**
 * Global Variables Management API
 *
 * POST /api/chats/[chatId]/variables - Save module toggle values
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  createApiErrorResponse,
  createUnexpectedRouteErrorResponse,
  parseJsonRequest,
  requireAuthenticatedUser,
} from '@/lib/http/api-contract'
import type { Json } from '@/types/database.types'
import { z } from 'zod'

export const runtime = 'nodejs'

interface Context {
  params: Promise<{ chatId: string }>
}

const variablesRequestSchema = z.object({
  variables: z.record(z.string(), z.unknown()),
})

function isJsonValue(value: unknown): value is Json {
  if (value === null) {
    return true
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return true
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue)
  }

  if (typeof value !== 'object') {
    return false
  }

  return Object.values(value as Record<string, unknown>).every(
    (entry) => typeof entry === 'undefined' || isJsonValue(entry),
  )
}

/**
 * POST - Save global variables for a chat
 */
export async function POST(request: NextRequest, context: Context) {
  try {
    const { chatId } = await context.params
    const supabase = await createClient()
    const auth = await requireAuthenticatedUser(supabase)
    if (!auth.success) {
      return auth.response
    }
    const { user } = auth

    // Verify chat ownership
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, user_id')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      return createApiErrorResponse('Chat not found', 404)
    }

    // Parse request body
    const parsed = await parseJsonRequest(request, variablesRequestSchema, {
      invalidBodyMessage: 'Invalid variables format',
    })
    if (!parsed.success) {
      return parsed.response
    }
    const { variables } = parsed.data

    const entries: Array<{ user_id: string; chat_id: string; key: string; value: Json }> = []

    for (const [key, value] of Object.entries(variables)) {
      if (!isJsonValue(value)) {
        return createApiErrorResponse('Invalid variable value', 400)
      }

      entries.push({
        user_id: user.id,
        chat_id: chatId,
        key,
        value,
      })
    }

    const newKeys = entries.map((entry) => entry.key)

    if (entries.length > 0) {
      const { error: upsertError } = await supabase.from('global_variables').upsert(entries, {
        onConflict: 'chat_id,key',
      })

      if (upsertError) {
        console.error('[Variables API] Upsert failed:', upsertError)
        return createApiErrorResponse('Failed to save variables', 500)
      }
    } else {
      // No entries submitted: clear everything for this chat
      const { error: deleteAllError } = await supabase
        .from('global_variables')
        .delete()
        .eq('chat_id', chatId)
        .eq('user_id', user.id)

      if (deleteAllError) {
        console.error('[Variables API] Failed to clear variables:', deleteAllError)
        return createApiErrorResponse('Failed to save variables', 500)
      }

      return Response.json({
        success: true,
        count: 0,
      })
    }

    const uniqueKeys = Array.from(new Set(newKeys))

    if (uniqueKeys.length > 0) {
      const keyFilter = `(${uniqueKeys.map((key) => JSON.stringify(key)).join(',')})`
      const { error: deleteError } = await supabase
        .from('global_variables')
        .delete()
        .eq('chat_id', chatId)
        .eq('user_id', user.id)
        .not('key', 'in', keyFilter)

      if (deleteError) {
        console.error('[Variables API] Cleanup delete failed:', deleteError)
        return createApiErrorResponse('Failed to save variables', 500)
      }
    }

    return Response.json({
      success: true,
      count: entries.length,
    })
  } catch (error) {
    return createUnexpectedRouteErrorResponse('[Variables API] Unexpected error:', error)
  }
}
