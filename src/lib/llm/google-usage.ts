import type { LanguageModelUsage } from 'ai'
import type { UsageCostBreakdown } from '@/lib/model-pricing'
import { isGoogleServiceTier, type GoogleServiceTier } from './service-tier'
import { priceUsageSteps, sumUsageSteps } from './usage'

export type GoogleUsageStep = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  serviceTier?: GoogleServiceTier
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function readGoogleUsageStep({
  usage,
  providerMetadata,
}: {
  usage: LanguageModelUsage
  providerMetadata?: Record<string, unknown>
}): GoogleUsageStep {
  const promptTokens = count(usage.inputTokens)
  const completionTokens = count(usage.outputTokens)
  const knownUsage = promptTokens !== null && completionTokens !== null
  // Gemini omits these optional counters when no cache/thinking was used.
  // Missing the usage itself must still remain unknown.
  const cachedInputTokens = count(usage.cachedInputTokens) ?? (knownUsage ? 0 : null)
  const reasoningTokens = count(usage.reasoningTokens) ?? (knownUsage ? 0 : null)
  const google = providerMetadata?.google as Record<string, unknown> | undefined
  return {
    promptTokens,
    completionTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens:
      count(usage.totalTokens) ??
      (knownUsage ? promptTokens + completionTokens + (reasoningTokens ?? 0) : null),
    ...(isGoogleServiceTier(google?.serviceTier) ? { serviceTier: google.serviceTier } : {}),
  }
}

export function sumGoogleUsage(steps: GoogleUsageStep[]): GoogleUsageStep {
  return sumUsageSteps(steps)
}

export function priceGoogleSteps({
  steps,
  modelName,
  serviceTier = 'standard',
}: {
  steps: GoogleUsageStep[]
  modelName: string
  serviceTier?: GoogleServiceTier
}): UsageCostBreakdown | null {
  return priceUsageSteps({ steps, provider: 'google', modelName, serviceTier })
}
