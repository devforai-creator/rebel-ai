import { createAdminClient } from '@/lib/supabase/admin'
import { translateMessageForUser, type TranslationResult } from '@/lib/chat/translation-service'
import { createInternalTranslationRouteResponse } from '@/lib/chat/translation-route-response'
import {
  createApiErrorResponse,
  createUnexpectedRouteErrorResponse,
  parseJsonRequest,
  requireBearerToken,
} from '@/lib/http/api-contract'
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

export async function POST(req: Request) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.error('[Translate] CHAT_ADMIN_SECRET not configured')
  }

  const auth = requireBearerToken(req, adminSecret)
  if (!auth.success) {
    return auth.response
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
      return Response.json({ success: true, skipped: true })
    }

    const translationResult: TranslationResult = await translateMessageForUser({
      supabase,
      getAdminClient: () => supabase,
      userId,
      messageId,
      messageContent: message.content,
      trimOutput: true,
    })
    return createInternalTranslationRouteResponse({
      result: translationResult,
      userId,
      messageId,
      logDebug: logTranslateRouteDebug,
    })
  } catch (error) {
    return createUnexpectedRouteErrorResponse('[Translate] Error:', error, {
      message: 'Translation failed',
    })
  }
}
