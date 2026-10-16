import type { LanguageModelUsage } from 'ai'
import { estimateUsageCost, type UsageCostBreakdown } from '@/lib/model-pricing'
import type { ApiServiceTier } from '@/types/database.types'

export type AnthropicUsageStep = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  cachedInputTokens: number | null
  reasoningTokens: number | null
  cacheWriteTokens?: number
  cacheWrite5mTokens?: number
  cacheWrite1hTokens?: number
}

type Step = { usage: LanguageModelUsage; providerMetadata?: Record<string, unknown> }
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
const number = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined

export function readAnthropicUsageStep({ usage, providerMetadata }: Step): AnthropicUsageStep {
  const metadata = record(providerMetadata?.anthropic)
  const raw = record(metadata.usage)
  const creation = record(raw.cache_creation)
  const writes =
    number(metadata.cacheCreationInputTokens) ?? number(raw.cache_creation_input_tokens)
  const write5m = number(creation.ephemeral_5m_input_tokens)
  const write1h = number(creation.ephemeral_1h_input_tokens)
  return {
    promptTokens: number(usage.inputTokens) ?? null,
    completionTokens: number(usage.outputTokens) ?? null,
    totalTokens: number(usage.totalTokens) ?? null,
    cachedInputTokens:
      number(usage.cachedInputTokens) ?? number(raw.cache_read_input_tokens) ?? null,
    reasoningTokens: number(usage.reasoningTokens) ?? null,
    ...(writes !== undefined ? { cacheWriteTokens: writes } : {}),
    ...(write5m !== undefined ? { cacheWrite5mTokens: write5m } : {}),
    ...(write1h !== undefined ? { cacheWrite1hTokens: write1h } : {}),
  }
}

export function sumAnthropicUsage(steps: AnthropicUsageStep[]): AnthropicUsageStep {
  const sum = (key: keyof AnthropicUsageStep) => {
    const values = steps.map((s) => s[key]).filter((v): v is number => typeof v === 'number')
    return values.length === steps.length ? values.reduce((a, b) => a + b, 0) : null
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

export function priceAnthropicSteps({
  steps,
  modelName,
  serviceTier,
  cacheWriteTtl,
}: {
  steps: AnthropicUsageStep[]
  modelName: string
  serviceTier?: ApiServiceTier | null
  cacheWriteTtl?: '5m' | '1h'
}): UsageCostBreakdown | null {
  if (
    steps.length === 0 ||
    steps.some((step) => step.promptTokens === null || step.completionTokens === null)
  )
    return null
  const costs = steps.map((step) =>
    estimateUsageCost({ ...step, provider: 'anthropic', modelName, serviceTier, cacheWriteTtl }),
  )
  if (costs.some((c) => c === null)) return null
  const result = { ...costs[0] } as UsageCostBreakdown
  for (const key of Object.keys(result) as Array<keyof UsageCostBreakdown>) {
    result[key] = costs.reduce((sum, cost) => sum + (cost?.[key] ?? 0), 0)
  }
  return result
}
