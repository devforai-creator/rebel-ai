export const SUPPORT_TIERS = {
  CORE: 'core',
  FALLBACK: 'fallback',
  EXPERIMENTAL: 'experimental',
  REMOVAL: 'removal',
} as const

export type SupportTier = (typeof SUPPORT_TIERS)[keyof typeof SUPPORT_TIERS]

export type SupportTierFeature = Readonly<{
  id: string
  tier: SupportTier
  description: string
}>

export const SUPPORT_TIER_HEADER = 'X-RebelAI-Support-Tier'

export const SUPPORT_TIER_FEATURES = {
  AUTHENTICATED_CHAT_CORE: {
    id: 'authenticated-chat-core',
    tier: SUPPORT_TIERS.CORE,
    description: 'Authenticated chat request -> queue -> runner core path',
  },
  PREFIX_LIVE_BLOCKS_MEMORY: {
    id: 'prefix-live-blocks-memory',
    tier: SUPPORT_TIERS.CORE,
    description: 'Maintainer-operated Prefix Live Blocks memory mode',
  },
  SUMMARY_WINDOW_MEMORY: {
    id: 'summary-window-memory',
    tier: SUPPORT_TIERS.FALLBACK,
    description: 'Maintained Summary Window memory fallback',
  },
  MESSAGE_TRANSLATION_TRIGGER: {
    id: 'message-translation-trigger',
    tier: SUPPORT_TIERS.EXPERIMENTAL,
    description: 'Background message translation trigger',
  },
  MESSAGE_REPROCESS: {
    id: 'message-reprocess',
    tier: SUPPORT_TIERS.EXPERIMENTAL,
    description: 'Message reprocess route',
  },
  LEGACY_ASSET_URL_COMPATIBILITY: {
    id: 'legacy-asset-url-compatibility',
    tier: SUPPORT_TIERS.REMOVAL,
    description: 'Legacy asset URL compatibility layer',
  },
} as const satisfies Record<string, SupportTierFeature>

export function withSupportTierHeaders(tier: SupportTier, headers?: HeadersInit): Headers {
  const nextHeaders = new Headers(headers)
  nextHeaders.set(SUPPORT_TIER_HEADER, tier)
  return nextHeaders
}

type DispatchNonBlockingSupportEffectOptions = {
  feature: SupportTierFeature
  execute: () => void | Promise<void>
  context?: Record<string, unknown>
  logPrefix?: string
  onError?: (error: unknown, feature: SupportTierFeature) => void | Promise<void>
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  if (typeof error === 'string') {
    return error
  }

  return String(error)
}

export function dispatchNonBlockingSupportEffect(
  options: DispatchNonBlockingSupportEffectOptions,
): void {
  void Promise.resolve()
    .then(() => options.execute())
    .catch(async (error) => {
      console.error(options.logPrefix ?? '[Support Tier]', 'Non-blocking support effect failed', {
        supportTier: options.feature.tier,
        supportFeatureId: options.feature.id,
        supportFeatureDescription: options.feature.description,
        error: normalizeErrorMessage(error),
        ...(options.context ?? {}),
      })

      if (!options.onError) {
        return
      }

      try {
        await options.onError(error, options.feature)
      } catch (onErrorFailure) {
        console.error(
          options.logPrefix ?? '[Support Tier]',
          'Failed to run support-effect error handler',
          {
            supportTier: options.feature.tier,
            supportFeatureId: options.feature.id,
            error: normalizeErrorMessage(onErrorFailure),
          },
        )
      }
    })
}
