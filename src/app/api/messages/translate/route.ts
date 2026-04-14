import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserRateLimit } from '@/lib/chat/rate-limiter'
import { translateMessageForUser, type TranslationResult } from '@/lib/chat/translation-service'
import { createApiErrorResponse, parseJsonRequest } from '@/lib/http/api-contract'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60

const translateRequestSchema = z.object({
  messageId: z.string().min(1),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return createApiErrorResponse('Unauthorized', 401)
  }

  // Rate limiting
  const { allowed, retryAfter } = await checkUserRateLimit(user.id)
  if (!allowed) {
    return createApiErrorResponse('Too many requests', 429, {
      retryAfter,
      headers: { 'Retry-After': String(retryAfter ?? 60) },
    })
  }

  const parsed = await parseJsonRequest(request, translateRequestSchema, {
    invalidBodyMessage: 'Missing messageId',
  })
  if (!parsed.success) {
    return parsed.response
  }
  const { messageId } = parsed.data

  // 1. Fetch the message to translate
  const { data: message, error: messageError } = await supabase
    .from('messages')
    .select('id, chat_id, role, content, content_en, user_id')
    .eq('id', messageId)
    .single()

  if (messageError || !message) {
    return createApiErrorResponse('Message not found', 404)
  }

  if (message.user_id !== user.id) {
    return createApiErrorResponse('Forbidden', 403)
  }

  let translationResult: TranslationResult
  try {
    translationResult = await translateMessageForUser({
      supabase,
      getAdminClient: createAdminClient,
      userId: user.id,
      messageId,
      messageContent: message.content,
      trimOutput: false,
    })
  } catch (error) {
    console.error('[Translate] Translation failed:', error)
    return createApiErrorResponse('Failed to translate message', 500)
  }

  switch (translationResult.status) {
    case 'missing_profile':
      return createApiErrorResponse('Configuration error', 400)
    case 'missing_api_key':
      return createApiErrorResponse('Translation not configured', 400)
    case 'invalid_api_key':
      return createApiErrorResponse('Invalid API key configuration', 400)
    case 'vault_error':
      return createApiErrorResponse('Failed to decrypt API key', 500)
    case 'save_error':
      console.error('[Translate] Update failed:', translationResult.error)
      return createApiErrorResponse('Failed to save translation', 500)
    case 'translation_error':
      console.error('[Translate] Translation failed:', translationResult.error)
      return createApiErrorResponse('Failed to translate message', 500)
    case 'success':
      return Response.json({ success: true, content_en: translationResult.content })
    default:
      return createApiErrorResponse('Failed to translate message', 500)
  }
}
