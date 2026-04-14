import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { translateMessageForUser, type TranslationResult } from '@/lib/chat/translation-service'
import { createApiErrorResponse, parseJsonRequest } from '@/lib/http/api-contract'
import { z } from 'zod'

export const runtime = 'nodejs'
export const maxDuration = 60
const TRANSLATE_ROUTE_DEBUG_ENABLED = process.env.TRANSLATE_ROUTE_DEBUG === 'true'

const translateMessageRequestSchema = z.object({
  messageId: z.string().min(1),
  userId: z.string().min(1),
})

function logTranslateRouteDebug(...args: unknown[]): void {
  if (TRANSLATE_ROUTE_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.error('[Translate] CHAT_ADMIN_SECRET not configured')
    return createApiErrorResponse('Server misconfigured', 500)
  }

  const authHeader = req.headers.get('authorization')
  if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
    return createApiErrorResponse('Unauthorized', 401)
  }

  const parsed = await parseJsonRequest(req, translateMessageRequestSchema, {
    invalidBodyMessage: 'Missing messageId or userId',
  })
  if (!parsed.success) {
    return parsed.response
  }
  const { messageId, userId } = parsed.data

  const supabase = createAdminClient()

  try {
    // 1. Fetch the message (with ownership check)
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('id, content, content_en')
      .eq('id', messageId)
      .eq('user_id', userId)
      .single<{ id: string; content: string; content_en: string | null }>()

    if (messageError || !message) {
      console.error('[Translate] Message not found:', messageId)
      return createApiErrorResponse('Message not found', 404)
    }

    // Skip if already translated
    if (message.content_en) {
      return NextResponse.json({ success: true, skipped: true })
    }

    const translationResult: TranslationResult = await translateMessageForUser({
      supabase,
      getAdminClient: () => supabase,
      userId,
      messageId,
      messageContent: message.content,
      trimOutput: true,
    })

    switch (translationResult.status) {
      case 'missing_profile':
      case 'missing_api_key':
        logTranslateRouteDebug('[Translate] No translation API key configured for user:', userId)
        return NextResponse.json({ success: true, skipped: true, reason: 'no_api_key' })
      case 'invalid_api_key':
        console.error('[Translate] API key not found or inactive:', translationResult.apiKeyId)
        return createApiErrorResponse('Invalid configuration', 400)
      case 'save_error':
        console.error('[Translate] Failed to save translation:', translationResult.error)
        return createApiErrorResponse('Failed to save translation', 500)
      case 'vault_error':
      case 'translation_error':
        console.error('[Translate] Error:', translationResult.error)
        return createApiErrorResponse('Translation failed', 500)
      case 'success':
        logTranslateRouteDebug('[Translate] Successfully translated message:', messageId)
        return NextResponse.json({ success: true, content_en: translationResult.content })
      default:
        return createApiErrorResponse('Translation failed', 500)
    }
  } catch (error) {
    console.error('[Translate] Error:', error)
    return createApiErrorResponse('Translation failed', 500)
  }
}
