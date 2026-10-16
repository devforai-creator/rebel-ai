import { readSdkUsageStep, reportedTokenCount, type SdkUsageStep, type UsageStep } from './usage'

export function readDeepSeekUsageStep(step: SdkUsageStep): UsageStep {
  const usage = readSdkUsageStep(step)
  const metadata = step.providerMetadata?.deepseek as Record<string, unknown> | undefined
  let hit = usage.cachedInputTokens ?? reportedTokenCount(metadata?.promptCacheHitTokens)
  const miss = reportedTokenCount(metadata?.promptCacheMissTokens)
  if (usage.promptTokens !== null) {
    if (hit === null && miss !== null && miss <= usage.promptTokens) hit = usage.promptTokens - miss
    if (
      hit !== null &&
      (hit > usage.promptTokens || (miss !== null && hit + miss !== usage.promptTokens))
    )
      hit = null
    if (usage.promptTokens === 0 && hit === null && miss === null) hit = 0
  }
  return {
    ...usage,
    cachedInputTokens: hit,
    modelName: typeof metadata?.responseModel === 'string' ? metadata.responseModel : null,
    pricingTimestamp:
      typeof metadata?.responseTimestamp === 'string' ? metadata.responseTimestamp : null,
  }
}
