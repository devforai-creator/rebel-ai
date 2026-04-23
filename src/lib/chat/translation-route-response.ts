import type { TranslationResult } from '@/lib/chat/translation-service'
import { createApiErrorResponse } from '@/lib/http/api-contract'

export function createInternalTranslationRouteResponse({
  result,
  userId,
  messageId,
  logDebug,
}: {
  result: TranslationResult
  userId: string
  messageId: string
  logDebug?: (...args: unknown[]) => void
}): Response {
  switch (result.status) {
    case 'missing_profile':
    case 'missing_api_key':
      logDebug?.('[Translate] No translation API key configured for user:', userId)
      return Response.json({ success: true, skipped: true, reason: 'no_api_key' })
    case 'invalid_api_key':
      console.error('[Translate] API key not found or inactive:', result.apiKeyId)
      return createApiErrorResponse('Invalid configuration', 400)
    case 'save_error':
      console.error('[Translate] Failed to save translation:', result.error)
      return createApiErrorResponse('Failed to save translation', 500)
    case 'vault_error':
    case 'translation_error':
      console.error('[Translate] Error:', result.error)
      return createApiErrorResponse('Translation failed', 500)
    case 'success':
      logDebug?.('[Translate] Successfully translated message:', messageId)
      return Response.json({ success: true, content_en: result.content })
    default:
      return createApiErrorResponse('Translation failed', 500)
  }
}

export function createPublicTranslationRouteResponse(result: TranslationResult): Response {
  switch (result.status) {
    case 'missing_profile':
      return createApiErrorResponse('Configuration error', 400)
    case 'missing_api_key':
      return createApiErrorResponse('Translation not configured', 400)
    case 'invalid_api_key':
      return createApiErrorResponse('Invalid API key configuration', 400)
    case 'vault_error':
      return createApiErrorResponse('Failed to decrypt API key', 500)
    case 'save_error':
      console.error('[Translate] Update failed:', result.error)
      return createApiErrorResponse('Failed to save translation', 500)
    case 'translation_error':
      console.error('[Translate] Translation failed:', result.error)
      return createApiErrorResponse('Failed to translate message', 500)
    case 'success':
      return Response.json({ success: true, content_en: result.content })
    default:
      return createApiErrorResponse('Failed to translate message', 500)
  }
}
