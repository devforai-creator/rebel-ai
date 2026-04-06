import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { translateMessageForUser, type TranslationResult } from '@/lib/chat/translation-service'

export const runtime = 'nodejs'
export const maxDuration = 60
const TRANSLATE_ROUTE_DEBUG_ENABLED = process.env.TRANSLATE_ROUTE_DEBUG === 'true'

function logTranslateRouteDebug(...args: unknown[]): void {
  if (TRANSLATE_ROUTE_DEBUG_ENABLED) {
    console.debug(...args)
  }
}

export async function POST(req: NextRequest) {
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.error('[Translate] CHAT_ADMIN_SECRET not configured')
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization')
  if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { messageId, userId } = (await req.json()) as {
    messageId: string
    userId: string
  }

  if (!messageId || !userId) {
    return NextResponse.json({ error: 'Missing messageId or userId' }, { status: 400 })
  }

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
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
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
        return NextResponse.json({ error: 'Invalid configuration' }, { status: 400 })
      case 'save_error':
        console.error('[Translate] Failed to save translation:', translationResult.error)
        return NextResponse.json({ error: 'Failed to save translation' }, { status: 500 })
      case 'vault_error':
      case 'translation_error':
        console.error('[Translate] Error:', translationResult.error)
        return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
      case 'success':
        logTranslateRouteDebug('[Translate] Successfully translated message:', messageId)
        return NextResponse.json({ success: true, content_en: translationResult.content })
      default:
        return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
    }
  } catch (error) {
    console.error('[Translate] Error:', error)
    return NextResponse.json({ error: 'Translation failed' }, { status: 500 })
  }
}
