import { createClient } from '@/lib/supabase/server'
import {
  createApiErrorResponse,
  createUnexpectedRouteErrorResponse,
  parseJsonRequest,
  requireAuthenticatedUser,
} from '@/lib/http/api-contract'
import { BASE_GLOBAL_SYSTEM_PROMPT } from '@/lib/chat/global-system-prompt'
import { parseSystemPromptOverrideInput } from '@/lib/chat/system-prompt-override'
import { z } from 'zod'

export const runtime = 'nodejs'

interface Context {
  params: Promise<{ chatId: string }>
}

const systemPromptSchema = z.object({
  systemPrompt: z.unknown(),
})

export async function POST(request: Request, context: Context) {
  try {
    const { chatId } = await context.params
    const supabase = await createClient()
    const auth = await requireAuthenticatedUser(supabase)
    if (!auth.success) {
      return auth.response
    }
    const { user } = auth

    const { data: chat, error: chatError } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chatId)
      .eq('user_id', user.id)
      .single()

    if (chatError || !chat) {
      return createApiErrorResponse('Chat not found', 404)
    }

    const parsed = await parseJsonRequest(request, systemPromptSchema, {
      invalidBodyMessage: 'Missing systemPrompt',
    })
    if (!parsed.success) {
      return parsed.response
    }
    const rawPrompt = parsed.data.systemPrompt
    const normalizedPrompt = parseSystemPromptOverrideInput(rawPrompt, BASE_GLOBAL_SYSTEM_PROMPT)

    if (!normalizedPrompt.success) {
      return createApiErrorResponse('Invalid systemPrompt', 400)
    }

    const { error: updateError } = await supabase
      .from('chats')
      .update({ custom_system_prompt: normalizedPrompt.systemPrompt })
      .eq('id', chatId)
      .eq('user_id', user.id)

    if (updateError) {
      console.error('[System Prompt API] Failed to update prompt', {
        chatId,
        userId: user.id,
        error: updateError.message,
      })
      return createApiErrorResponse('Failed to update system prompt', 500)
    }

    return Response.json({ success: true })
  } catch (error) {
    return createUnexpectedRouteErrorResponse('[System Prompt API] Unexpected error', error)
  }
}
