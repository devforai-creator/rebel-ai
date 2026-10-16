import {
  readSdkUsageStep,
  hasRequiredUsage,
  reportedTokenCount,
  type SdkUsageStep,
  type UsageStep,
} from './usage'

export function readOpenRouterUsageStep(step: SdkUsageStep): UsageStep {
  const usage = readSdkUsageStep(step)
  const metadata = step.providerMetadata?.openrouter as Record<string, unknown> | undefined
  const openai = step.providerMetadata?.openai as Record<string, unknown> | undefined
  const extra = openai?.usage as Record<string, unknown> | undefined
  const writes = reportedTokenCount(extra?.cacheWriteTokens) ?? (hasRequiredUsage(usage) ? 0 : null)
  const cost = metadata?.reportedCostUsd
  return {
    ...usage,
    ...(writes !== null ? { cacheWriteTokens: writes } : {}),
    reportedCostUsd: typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 ? cost : null,
    modelName: typeof metadata?.responseModel === 'string' ? metadata.responseModel : null,
  }
}
