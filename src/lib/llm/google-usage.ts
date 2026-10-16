import { isGoogleServiceTier } from './service-tier'
import { readSdkUsageStep, hasRequiredUsage, type SdkUsageStep, type UsageStep } from './usage'

export function readGoogleUsageStep(step: SdkUsageStep): UsageStep {
  const usage = readSdkUsageStep(step)
  const knownUsage = hasRequiredUsage(usage)
  // Gemini omits optional cache/thinking counters when they are zero.
  const cachedInputTokens = usage.cachedInputTokens ?? (knownUsage ? 0 : null)
  const reasoningTokens = usage.reasoningTokens ?? (knownUsage ? 0 : null)
  const google = step.providerMetadata?.google as Record<string, unknown> | undefined
  return {
    ...usage,
    cachedInputTokens,
    reasoningTokens,
    totalTokens:
      usage.totalTokens ??
      (knownUsage ? usage.promptTokens! + usage.completionTokens! + (reasoningTokens ?? 0) : null),
    pricingTimestamp: typeof google?.pricingTimestamp === 'string' ? google.pricingTimestamp : null,
    ...(isGoogleServiceTier(google?.serviceTier) ? { serviceTier: google.serviceTier } : {}),
  }
}
