import type { LanguageModelUsage } from 'ai'
import { estimateUsageCost, type UsageCostBreakdown } from '@/lib/model-pricing'
import { isGoogleServiceTier, type GoogleServiceTier } from './service-tier'

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
  const sum = (key: Exclude<keyof GoogleUsageStep, 'serviceTier'>) => {
    const values = steps.map((step) => step[key])
    return steps.length > 0 && values.every((value) => value !== null)
      ? values.reduce((total, value) => total + value, 0)
      : null
  }
  return {
    promptTokens: sum('promptTokens'),
    completionTokens: sum('completionTokens'),
    totalTokens: sum('totalTokens'),
    cachedInputTokens: sum('cachedInputTokens'),
    reasoningTokens: sum('reasoningTokens'),
  }
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
  if (
    steps.length === 0 ||
    steps.some((step) => step.promptTokens === null || step.completionTokens === null)
  )
    return null
  // Choose the long-context band and the returned service tier for each call.
  const costs = steps.map((step) =>
    estimateUsageCost({
      ...step,
      provider: 'google',
      modelName,
      serviceTier: step.serviceTier ?? serviceTier,
    }),
  )
  if (costs.some((cost) => cost === null)) return null
  const result = { ...costs[0] } as UsageCostBreakdown
  for (const key of Object.keys(result) as Array<keyof UsageCostBreakdown>) {
    result[key] = costs.reduce((total, cost) => total + (cost?.[key] ?? 0), 0)
  }
  return result
}
