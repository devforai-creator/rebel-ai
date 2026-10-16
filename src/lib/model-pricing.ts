import type { ApiServiceTier, Provider } from '@/types/database.types'
import type { ModelPricingRateSet as RateSet } from './models'
import { getModelPricingTiers } from './models'
import { getDeepSeekPricingPeriod } from './deepseek/pricing'

const TOKENS_PER_MILLION = 1_000_000

export type UsageCostParams = {
  pricingTimestamp?: string | Date | null
  provider: Provider
  modelName?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  cachedInputTokens?: number | null
  cacheWriteTokens?: number | null
  cacheWrite5mTokens?: number | null
  cacheWrite1hTokens?: number | null
  cacheWriteTtl?: '5m' | '1h'
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
  uncachedPromptCost?: number
  cacheWriteTokens?: number
  cacheWriteCost?: number
  cacheWrite5mTokens?: number
  cacheWrite1hTokens?: number
  cacheWrite5mCost?: number
  cacheWrite1hCost?: number
}

function resolveRates({
  provider,
  modelName,
  promptTokens,
  serviceTier,
  pricingTimestamp,
}: {
  provider: Provider
  modelName?: string | null
  promptTokens?: number | null
  serviceTier?: ApiServiceTier | null
  pricingTimestamp?: string | Date | null
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

  if (provider === 'google' && serviceTier === 'flex') return tier?.flexRates ?? null
  if (provider === 'openai' && serviceTier === 'priority') return tier?.priorityRates ?? null
  if (provider === 'deepseek') {
    const period = getDeepSeekPricingPeriod(pricingTimestamp)
    if (period === 'unknown') return null
    return period === 'peak' ? (tier?.peakRates ?? null) : (tier?.rates ?? null)
  }
  return tier?.rates ?? null
}

function getServiceTierMultiplier(provider: Provider, serviceTier?: ApiServiceTier | null): number {
  if (provider === 'openai' && (serviceTier === 'flex' || serviceTier === 'batch')) {
    return 0.5
  }
  if (provider === 'anthropic' && serviceTier === 'batch') {
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
  if (!isReportedTokenCount(params.promptTokens) || !isReportedTokenCount(params.completionTokens))
    return null
  const promptTokens = sanitizeTokens(params.promptTokens)
  const completionTokens = sanitizeTokens(params.completionTokens)
  const cachedInputTokens = sanitizeTokens(params.cachedInputTokens)
  const reasoningTokens = sanitizeTokens(params.reasoningTokens)
  const reportedWrites = sanitizeTokens(params.cacheWriteTokens)
  if (
    (params.provider === 'openai' ||
      params.provider === 'deepseek' ||
      params.provider === 'openrouter') &&
    (reasoningTokens > completionTokens || cachedInputTokens + reportedWrites > promptTokens)
  )
    return null
  if (
    (params.provider === 'deepseek' || params.provider === 'openrouter') &&
    !isReportedTokenCount(params.cachedInputTokens)
  )
    return null
  let write5m = sanitizeTokens(params.cacheWrite5mTokens)
  let write1h = sanitizeTokens(params.cacheWrite1hTokens)
  const unclassifiedWrites = Math.max(reportedWrites - write5m - write1h, 0)
  if (params.cacheWriteTtl === '1h') write1h += unclassifiedWrites
  else write5m += unclassifiedWrites
  // Anthropic reports uncached input separately; cached reads and writes still
  // count toward the full prompt length that determines the pricing tier.
  const pricingPromptTokens =
    params.provider === 'anthropic'
      ? promptTokens + cachedInputTokens + write5m + write1h
      : promptTokens
  const rates = resolveRates({
    provider: params.provider,
    modelName: params.modelName,
    promptTokens: pricingPromptTokens,
    serviceTier: params.serviceTier,
    pricingTimestamp: params.pricingTimestamp,
  })
  if (!rates) {
    return null
  }
  if (
    (params.provider === 'openai' || params.provider === 'openrouter') &&
    reportedWrites > 0 &&
    rates.cacheWrite === undefined
  )
    return null

  const cacheWriteTokens =
    params.provider === 'anthropic' ||
    ((params.provider === 'openai' || params.provider === 'openrouter') &&
      rates.cacheWrite !== undefined)
      ? params.provider === 'anthropic'
        ? write5m + write1h
        : reportedWrites
      : 0

  // Provider-specific token calculation:
  // - Anthropic: AI SDK returns inputTokens as uncached only (already excludes cached)
  // - OpenAI/Others: AI SDK returns inputTokens as total (includes cached)
  // See: https://github.com/vercel/ai/issues/9921
  const effectivePromptTokens =
    params.provider === 'anthropic'
      ? promptTokens // Anthropic: inputTokens is already uncached
      : Math.max(promptTokens - cachedInputTokens - cacheWriteTokens, 0)

  // These providers include reasoning in outputTokens; charge each token once.
  const effectiveCompletionTokens =
    params.provider === 'openai' ||
    params.provider === 'deepseek' ||
    params.provider === 'openrouter'
      ? Math.max(completionTokens - reasoningTokens, 0)
      : completionTokens

  const multiplier = getServiceTierMultiplier(params.provider, params.serviceTier)

  // Cache writes are input costs and are persisted with prompt_cost_usd.
  const uncachedPromptCost = calculateCost(effectivePromptTokens, rates.input, multiplier)
  const cacheWrite5mCost =
    params.provider === 'anthropic' ? calculateCost(write5m, rates.input * 1.25, multiplier) : 0
  const cacheWrite1hCost =
    params.provider === 'anthropic' ? calculateCost(write1h, rates.input * 2, multiplier) : 0
  const cacheWriteCost =
    params.provider === 'anthropic'
      ? cacheWrite5mCost + cacheWrite1hCost
      : calculateCost(cacheWriteTokens, rates.cacheWrite ?? rates.input, multiplier)
  const promptCost = uncachedPromptCost + cacheWriteCost
  const cachedInputRate = rates.cachedInput ?? rates.input
  const cachedInputCost = calculateCost(cachedInputTokens, cachedInputRate, multiplier)
  const completionCost = calculateCost(effectiveCompletionTokens, rates.output, multiplier)
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
    uncachedPromptCost,
    cacheWriteTokens,
    cacheWriteCost,
    cacheWrite5mTokens: params.provider === 'anthropic' ? write5m : 0,
    cacheWrite1hTokens: params.provider === 'anthropic' ? write1h : 0,
    cacheWrite5mCost,
    cacheWrite1hCost,
  }
}

function sanitizeTokens(value?: number | null): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 0
  }
  return value
}

function isReportedTokenCount(value?: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
