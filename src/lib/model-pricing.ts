import type { ApiServiceTier, Provider } from '@/types/database.types'
import type { ModelPricingRateSet as RateSet } from './models'
import { getModelPricingTiers } from './models'

const TOKENS_PER_MILLION = 1_000_000

export type UsageCostParams = {
  provider: Provider
  modelName?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  cachedInputTokens?: number | null
  reasoningTokens?: number | null
  serviceTier?: ApiServiceTier | null
}

export type UsageCostBreakdown = {
  promptTokens: number
  completionTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  promptCost: number
  completionCost: number
  cachedInputCost: number
  reasoningCost: number
  totalCost: number
}

function resolveRates({
  provider,
  modelName,
  promptTokens,
}: {
  provider: Provider
  modelName?: string | null
  promptTokens?: number | null
}): RateSet | null {
  const tokens =
    typeof promptTokens === 'number' && Number.isFinite(promptTokens) ? promptTokens : 0

  const pricingTiers = getModelPricingTiers({ provider, modelName })
  if (!pricingTiers || pricingTiers.length === 0) {
    return null
  }

  const tier =
    pricingTiers.find((candidate) => {
      if (typeof candidate.maxPromptTokens === 'number') {
        return tokens <= candidate.maxPromptTokens
      }
      return true
    }) ?? pricingTiers[pricingTiers.length - 1]

  return tier?.rates ?? null
}

function getServiceTierMultiplier(provider: Provider, serviceTier?: ApiServiceTier | null): number {
  if (provider === 'openai' && serviceTier === 'flex') {
    return 0.5
  }
  return 1
}

function calculateCost(tokens: number, ratePerMillion: number, multiplier: number): number {
  if (!tokens || tokens <= 0) {
    return 0
  }
  if (!ratePerMillion || ratePerMillion <= 0) {
    return 0
  }
  return (tokens / TOKENS_PER_MILLION) * ratePerMillion * multiplier
}

export function estimateUsageCost(params: UsageCostParams): UsageCostBreakdown | null {
  const rates = resolveRates({
    provider: params.provider,
    modelName: params.modelName,
    promptTokens: params.promptTokens,
  })
  if (!rates) {
    return null
  }

  const promptTokens = sanitizeTokens(params.promptTokens)
  const completionTokens = sanitizeTokens(params.completionTokens)
  const cachedInputTokens = sanitizeTokens(params.cachedInputTokens)
  const reasoningTokens = sanitizeTokens(params.reasoningTokens)

  // Provider-specific token calculation:
  // - Anthropic: AI SDK returns inputTokens as uncached only (already excludes cached)
  // - OpenAI/Others: AI SDK returns inputTokens as total (includes cached)
  // See: https://github.com/vercel/ai/issues/9921
  const effectivePromptTokens =
    params.provider === 'anthropic'
      ? promptTokens // Anthropic: inputTokens is already uncached
      : Math.max(promptTokens - cachedInputTokens, 0) // Others: subtract cached from total

  const multiplier = getServiceTierMultiplier(params.provider, params.serviceTier)

  const promptCost = calculateCost(effectivePromptTokens, rates.input, multiplier)
  const cachedInputRate = rates.cachedInput ?? rates.input
  const cachedInputCost = calculateCost(cachedInputTokens, cachedInputRate, multiplier)
  const completionCost = calculateCost(completionTokens, rates.output, multiplier)
  const reasoningRate = rates.reasoning ?? rates.output
  const reasoningCost = calculateCost(reasoningTokens, reasoningRate, multiplier)
  const totalCost = promptCost + cachedInputCost + completionCost + reasoningCost

  return {
    promptTokens,
    completionTokens,
    cachedInputTokens,
    reasoningTokens,
    promptCost,
    completionCost,
    cachedInputCost,
    reasoningCost,
    totalCost,
  }
}

function sanitizeTokens(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0
  }
  return value
}
