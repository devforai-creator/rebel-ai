import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserRateLimit } from '@/lib/chat/rate-limiter'
import { translateMessageForUser, type TranslationResult } from '@/lib/chat/translation-service'
import { createPublicTranslationRouteResponse } from '@/lib/chat/translation-route-response'
import {
  createApiErrorResponse,
  parseJsonRequest,
  requireAuthenticatedUser,
} from '@/lib/http/api-contract'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60

const translateRequestSchema = z.object({
  messageId: z.string().min(1),
})

export async function POST(request: Request) {
  const supabase = await createClient()
  const auth = await requireAuthenticatedUser(supabase)
  if (!auth.success) {
    return auth.response
  }
  const { user } = auth

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

  return createPublicTranslationRouteResponse(translationResult)
}
