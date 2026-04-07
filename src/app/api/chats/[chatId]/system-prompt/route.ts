import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

export const runtime = 'nodejs'

interface Context {
  params: Promise<{ chatId: string }>
}

const systemPromptSchema = z.object({
  systemPrompt: z.unknown(),
})

export async function POST(request: NextRequest, context: Context) {
  try {
    const { chatId } = await context.params
    const supabase = await createClient()

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
    }

    const parsed = systemPromptSchema.safeParse(await request.json().catch(() => null))

    if (!parsed.success) {
      return NextResponse.json({ error: 'Missing systemPrompt' }, { status: 400 })
    }

    const rawPrompt = parsed.data.systemPrompt
    let normalizedPrompt: string | null = null

    if (typeof rawPrompt === 'string') {
      const trimmed = rawPrompt.trim()
      normalizedPrompt = trimmed.length > 0 ? trimmed : null
    } else if (rawPrompt === null) {
      normalizedPrompt = null
    } else {
      return NextResponse.json({ error: 'Invalid systemPrompt' }, { status: 400 })
    }

    const { error: updateError } = await supabase
      .from('chats')
      .update({ custom_system_prompt: normalizedPrompt })
      .eq('id', chatId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[System Prompt API] Failed to update prompt', {
        chatId,
        userId: user.id,
        error: updateError.message,
      })
      return NextResponse.json({ error: 'Failed to update system prompt' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[System Prompt API] Unexpected error', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
