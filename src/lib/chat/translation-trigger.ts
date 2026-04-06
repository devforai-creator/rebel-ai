import { resolveInternalApiOrigin } from '@/lib/internal-api-origin'

/**
 * Fire-and-forget trigger for background message translation.
 * Silently fails if translation is not configured or encounters errors.
 */
export function triggerMessageTranslation(messageId: string, userId: string): void {
  const origin = resolveInternalApiOrigin()
  const adminSecret = process.env.CHAT_ADMIN_SECRET

  if (!adminSecret) {
    console.warn('[Translation Trigger] CHAT_ADMIN_SECRET not configured, skipping translation')
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
  }).catch((error) => {
    // Silently log errors - translation is non-critical
    console.error('[Translation Trigger] Failed to trigger translation:', error)
  })
}
