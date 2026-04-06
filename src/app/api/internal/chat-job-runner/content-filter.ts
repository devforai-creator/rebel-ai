import type { FinishReason } from 'ai'

export function evaluateContentFilter({
  provider,
  finishReason,
  metadata,
}: {
  provider: string
  finishReason: FinishReason | undefined
  metadata: unknown
}): { blocked: boolean; categories: string[] } {
  const normalizedFinish = typeof finishReason === 'string' ? finishReason : 'unknown'
  let blocked = normalizedFinish === 'content-filter'
  let categories: string[] = []

  if (provider !== 'google') {
    return { blocked, categories }
  }

  const googleMetadata =
    metadata && typeof metadata === 'object' && metadata !== null && 'google' in metadata
      ? ((metadata as { google?: Record<string, unknown> }).google ?? {})
      : {}

  const finishReasonDetails =
    googleMetadata && typeof googleMetadata === 'object' && 'finishReason' in googleMetadata
      ? googleMetadata.finishReason
      : null

  if (finishReasonDetails && typeof finishReasonDetails === 'string') {
    blocked = blocked || finishReasonDetails === 'SAFETY'
  }

  const safetyRatings =
    googleMetadata && typeof googleMetadata === 'object' && 'safetyRatings' in googleMetadata
      ? (googleMetadata.safetyRatings as Array<{ category?: string; probability?: string }> | null)
      : null

  if (Array.isArray(safetyRatings)) {
    categories = safetyRatings
      .map((rating) => rating?.category)
      .filter((category): category is string => typeof category === 'string')
  }

  return { blocked, categories }
}
