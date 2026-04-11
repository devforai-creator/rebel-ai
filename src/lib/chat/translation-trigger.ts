import { resolveInternalApiOrigin } from '@/lib/internal-api-origin'
import {
  recordMessageTranslationTriggerFailure,
  recordMessageTranslationTriggerSuccess,
} from './translation-trigger-monitor'

/**
 * Fire-and-forget trigger for background message translation.
 * Translation is experimental, so failures should be observable in lightweight
 * triage but must not block the supported core chat path.
 */
export function triggerMessageTranslation(messageId: string, userId: string): void {
  const origin = resolveInternalApiOrigin()
  const adminSecret = process.env.CHAT_ADMIN_SECRET
  const metadata = { messageId, userId, origin }

  if (!adminSecret) {
    console.warn('[Translation Trigger] CHAT_ADMIN_SECRET not configured, skipping translation')
    void recordMessageTranslationTriggerFailure('missing chat admin secret', {
      ...metadata,
      stage: 'schedule',
    })
    return
  }

  // Fire-and-forget - don't await, don't block
  fetch(`${origin}/api/internal/translate-message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${adminSecret}`,
    },
    body: JSON.stringify({ messageId, userId }),
  })
    .then(async (response) => {
      if (response.ok) {
        await recordMessageTranslationTriggerSuccess({
          ...metadata,
          status: response.status,
        })
        return
      }

      const text = await response.text().catch(() => '')
      await recordMessageTranslationTriggerFailure(
        new Error(`Translation trigger responded with ${response.status}`),
        {
          ...metadata,
          stage: 'dispatch',
          status: response.status,
          body: text.slice(0, 200),
        },
      )
      console.error('[Translation Trigger] Translation trigger responded with non-OK status', {
        ...metadata,
        status: response.status,
        body: text,
      })
    })
    .catch((error) => {
      console.error('[Translation Trigger] Failed to trigger translation:', error)
      void recordMessageTranslationTriggerFailure(error, {
        ...metadata,
        stage: 'dispatch',
      })
    })
}
