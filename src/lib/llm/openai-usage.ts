import {
  readSdkUsageStep,
  hasRequiredUsage,
  reportedTokenCount,
  type UsageServiceTier,
  type SdkUsageStep,
  type UsageStep,
} from './usage'

export function normalizeOpenAIServiceTier(value: unknown): UsageServiceTier | undefined {
  if (value === undefined || value === null) return undefined
  if (value === 'default' || value === 'standard') return 'standard'
  if (value === 'priority' || value === 'fast') return 'priority'
  if (value === 'flex' || value === 'batch') return value
  // Do not charge an unrecognized mode (e.g. Scale/Ultrafast) at Standard rates.
  return 'unknown'
}

export function readOpenAIUsageStep(step: SdkUsageStep): UsageStep {
  const usage = readSdkUsageStep(step)
  const known = hasRequiredUsage(usage)
  const metadata = step.providerMetadata?.openai as Record<string, unknown> | undefined
  const extra = metadata?.usage as Record<string, unknown> | undefined
  const writes = reportedTokenCount(extra?.cacheWriteTokens) ?? (known ? 0 : null)
  const serviceTier = normalizeOpenAIServiceTier(metadata?.serviceTier)
  return {
    ...usage,
    cachedInputTokens: usage.cachedInputTokens ?? (known ? 0 : null),
    reasoningTokens: usage.reasoningTokens ?? (known ? 0 : null),
    ...(writes !== null ? { cacheWriteTokens: writes } : {}),
    ...(serviceTier ? { serviceTier } : {}),
  }
}
