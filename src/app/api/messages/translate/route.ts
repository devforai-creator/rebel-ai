import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserRateLimit } from '@/lib/chat/rate-limiter'
import { translateMessageForUser, type TranslationResult } from '@/lib/chat/translation-service'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Rate limiting
  const { allowed, retryAfter } = await checkUserRateLimit(user.id)
  if (!allowed) {
    return new Response('Too many requests', {
      status: 429,
      headers: { 'Retry-After': String(retryAfter ?? 60) },
    })
  }

  const body = await request.json()
  const { messageId } = body as { messageId: string }

  if (!messageId) {
    return new Response('Missing messageId', { status: 400 })
  }

  // 1. Fetch the message to translate
  const { data: message, error: messageError } = await supabase
    .from('messages')
    .select('id, chat_id, role, content, content_en, user_id')
    .eq('id', messageId)
    .single()

  if (messageError || !message) {
    return new Response('Message not found', { status: 404 })
  }

  if (message.user_id !== user.id) {
    return new Response('Forbidden', { status: 403 })
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
    return new Response('Failed to translate message', { status: 500 })
  }

  switch (translationResult.status) {
    case 'missing_profile':
      return new Response('Configuration error', { status: 400 })
    case 'missing_api_key':
      return new Response('Translation not configured', { status: 400 })
    case 'invalid_api_key':
      return new Response('Invalid API key configuration', { status: 400 })
    case 'vault_error':
      return new Response('Failed to decrypt API key', { status: 500 })
    case 'save_error':
      console.error('[Translate] Update failed:', translationResult.error)
      return new Response('Failed to save translation', { status: 500 })
    case 'translation_error':
      console.error('[Translate] Translation failed:', translationResult.error)
      return new Response('Failed to translate message', { status: 500 })
    case 'success':
      return Response.json({ success: true, content_en: translationResult.content })
    default:
      return new Response('Failed to translate message', { status: 500 })
  }
}
