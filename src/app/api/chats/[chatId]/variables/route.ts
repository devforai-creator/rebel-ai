/**
 * Global Variables Management API
 *
 * POST /api/chats/[chatId]/variables - Save module toggle values
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/types/database.types'

export const runtime = 'nodejs'

interface Context {
  params: Promise<{ chatId: string }>
}

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

    // Verify authentication
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Verify chat ownership
    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id, user_id')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    // Parse request body
    const { variables } = await request.json()

    if (!variables || typeof variables !== 'object') {
      return NextResponse.json({ error: 'Invalid variables format' }, { status: 400 })
    }

    const entries: Array<{ user_id: string; chat_id: string; key: string; value: Json }> = []

    for (const [key, value] of Object.entries(variables)) {
      if (!isJsonValue(value)) {
        return NextResponse.json({ error: 'Invalid variable value' }, { status: 400 })
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
        return NextResponse.json({ error: 'Failed to save variables' }, { status: 500 })
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
        return NextResponse.json({ error: 'Failed to save variables' }, { status: 500 })
      }

      return NextResponse.json({
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
        return NextResponse.json({ error: 'Failed to save variables' }, { status: 500 })
      }
    }

    return NextResponse.json({
      success: true,
      count: entries.length,
    })
  } catch (error) {
    console.error('[Variables API] Unexpected error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
