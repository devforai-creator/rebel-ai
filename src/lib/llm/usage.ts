import type { LanguageModelUsage } from 'ai'
import {
  estimateUsageCost,
  type UsageCostBreakdown,
  type UsageCostParams,
} from '@/lib/model-pricing'
import type { ApiServiceTier, Provider } from '@/types/database.types'

export type UsageServiceTier = ApiServiceTier | 'unknown'
export type UsageStep = {
  modelName?: string | null
  pricingTimestamp?: string | null
  reportedCostUsd?: number | null
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  cacheWriteTokens?: number
  cacheWrite5mTokens?: number
  cacheWrite1hTokens?: number
  serviceTier?: UsageServiceTier
}
export type SdkUsageStep = { usage: LanguageModelUsage; providerMetadata?: Record<string, unknown> }

export function reportedTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function hasRequiredUsage(
  step: Pick<UsageStep, 'promptTokens' | 'completionTokens'>,
): boolean {
  return (
    reportedTokenCount(step.promptTokens) !== null &&
    reportedTokenCount(step.completionTokens) !== null
  )
}

export function readSdkUsageStep({ usage }: SdkUsageStep): UsageStep {
  return {
    promptTokens: reportedTokenCount(usage.inputTokens),
    completionTokens: reportedTokenCount(usage.outputTokens),
    totalTokens: reportedTokenCount(usage.totalTokens),
    cachedInputTokens: reportedTokenCount(usage.cachedInputTokens),
    reasoningTokens: reportedTokenCount(usage.reasoningTokens),
  }
}

export function sumUsageSteps(
  steps: UsageStep[],
): Omit<UsageStep, 'serviceTier' | 'modelName' | 'pricingTimestamp' | 'reportedCostUsd'> {
  const sum = (
    key: Exclude<
      keyof UsageStep,
      'serviceTier' | 'modelName' | 'pricingTimestamp' | 'reportedCostUsd'
    >,
  ) => {
    const values = steps.map((step) => reportedTokenCount(step[key]))
    return steps.length && values.every((value) => value !== null)
      ? values.reduce((total, value) => total + value, 0)
      : null
  }
  const writes = sum('cacheWriteTokens')
  return {
    promptTokens: sum('promptTokens'),
    completionTokens: sum('completionTokens'),
    totalTokens: sum('totalTokens'),
    cachedInputTokens: sum('cachedInputTokens'),
    reasoningTokens: sum('reasoningTokens'),
    ...(writes !== null ? { cacheWriteTokens: writes } : {}),
  }
}

// A partial provider total must never look like the complete cost of an ATR turn.
export function sumReportedUsageCost(steps: UsageStep[]): number | null {
  if (
    !steps.length ||
    steps.some(
      (step) =>
        typeof step.reportedCostUsd !== 'number' ||
        !Number.isFinite(step.reportedCostUsd) ||
        step.reportedCostUsd < 0,
    )
  )
    return null
  const total = steps.reduce((sum, step) => sum + step.reportedCostUsd!, 0)
  return Number.isFinite(total) ? total : null
}

export function priceUsageSteps({
  steps,
  provider,
  modelName,
  serviceTier,
  cacheWriteTtl,
}: {
  steps: UsageStep[]
  provider: Provider
  modelName: string
  serviceTier?: ApiServiceTier | null
  cacheWriteTtl?: UsageCostParams['cacheWriteTtl']
}): UsageCostBreakdown | null {
  if (
    !steps.length ||
    steps.some((step) => !hasRequiredUsage(step) || step.serviceTier === 'unknown')
  )
    return null
  const costs = steps.map((step) =>
    estimateUsageCost({
      ...step,
      provider,
      modelName:
        provider === 'deepseek'
          ? step.modelName
          : provider === 'openrouter'
            ? (step.modelName ?? modelName)
            : modelName,
      serviceTier: step.serviceTier === 'unknown' ? undefined : (step.serviceTier ?? serviceTier),
      cacheWriteTtl,
    }),
  )
  if (costs.some((cost) => cost === null)) return null
  const result = { ...costs[0] } as UsageCostBreakdown
  for (const key of Object.keys(result) as Array<keyof UsageCostBreakdown>) {
    result[key] = costs.reduce((total, cost) => total + (cost?.[key] ?? 0), 0)
  }
  return result
}

export function summarizeUsageServiceTier(
  steps: UsageStep[],
  fallback: ApiServiceTier = 'standard',
) {
  const tiers = new Set(steps.map((step) => step.serviceTier ?? fallback))
  return tiers.size > 1 ? 'mixed' : ([...tiers][0] ?? fallback)
}
