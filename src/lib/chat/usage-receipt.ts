import { z } from 'zod'
import { resolveCacheWriteUsage, type CacheWriteUsage } from './cache-write-usage'
import { outputIncludesReasoning } from '@/lib/llm/usage-semantics'
import type { UsageCostBreakdown } from '@/lib/model-pricing'
import type { LlmProvider } from '@/types/database.types'
import type { UsageServiceTier } from '@/lib/llm/usage'
import type { DeepSeekPricingPeriod } from '@/lib/deepseek/pricing'

const count = z.number().finite().nonnegative().nullable()
const receiptSchema = z.object({
  version: z.literal(1),
  requestId: z.string().min(1),
  provider: z.string(),
  modelName: z.string(),
  callCount: z.number().int().positive(),
  costSource: z.enum(['provider', 'estimated']).optional(),
  input: count,
  uncachedInput: count,
  output: count,
  visibleOutput: count.optional(),
  cacheWriteTokens: count.optional(),
  // Optional for receipts written before Google thinking usage was retained.
  reasoningTokens: count.optional(),
  totalTokens: count.optional(),
  serviceTier: z.enum(['standard', 'flex', 'priority', 'batch', 'unknown', 'mixed']).optional(),
  pricingPeriod: z.enum(['peak', 'off_peak', 'mixed', 'unknown']).optional(),
  billingModels: z.array(z.string().min(1)).optional(),
  cachedInput: count,
  cacheWrite5m: count,
  cacheWrite1h: count,
  cost: z
    .object({
      total: count,
      input: count,
      output: count,
      cacheRead: count,
      cacheWrite5m: count,
      cacheWrite1h: count,
      reasoning: count,
      cacheWrite: count.optional(),
    })
    .nullable(),
})
export type UsageReceipt = z.infer<typeof receiptSchema>

export function buildUsageReceipt({
  requestId,
  provider,
  modelName,
  usage,
  cost,
  callCount,
  serviceTier,
  pricingPeriod,
  billingModels,
  cacheWriteTtl,
}: {
  requestId: string
  provider: LlmProvider
  modelName: string
  callCount: number
  serviceTier?: UsageServiceTier | 'mixed'
  pricingPeriod?: DeepSeekPricingPeriod | 'mixed'
  billingModels?: string[]
  cacheWriteTtl?: '5m' | '1h'
  usage: CacheWriteUsage & {
    reportedCostUsd?: number | null
    promptTokens: number | null
    completionTokens: number | null
    cachedInputTokens: number | null
    cacheWriteTokens?: number
    reasoningTokens?: number | null
    totalTokens?: number | null
  }
  cost: UsageCostBreakdown | null
}): UsageReceipt {
  const anthropic = provider === 'anthropic'
  const openai = provider === 'openai'
  const deepseek = provider === 'deepseek'
  const openrouter = provider === 'openrouter'
  const inclusiveOutput = outputIncludesReasoning(provider)
  const reportedCostUsd =
    openrouter &&
    typeof usage.reportedCostUsd === 'number' &&
    Number.isFinite(usage.reportedCostUsd) &&
    usage.reportedCostUsd >= 0
      ? usage.reportedCostUsd
      : null
  const knownUsage = usage.promptTokens !== null && usage.completionTokens !== null
  if (!knownUsage || (deepseek && usage.cachedInputTokens === null)) cost = null
  const writes = resolveCacheWriteUsage(usage, cacheWriteTtl)
  return {
    version: 1,
    requestId,
    provider,
    modelName,
    callCount,
    ...(openrouter && (reportedCostUsd !== null || cost)
      ? { costSource: reportedCostUsd !== null ? ('provider' as const) : ('estimated' as const) }
      : {}),
    input:
      anthropic && usage.promptTokens !== null
        ? usage.promptTokens + (usage.cachedInputTokens ?? 0) + (writes.cacheWriteTokens ?? 0)
        : usage.promptTokens,
    uncachedInput: anthropic
      ? usage.promptTokens
      : (provider === 'google' || inclusiveOutput) &&
          usage.promptTokens !== null &&
          usage.cachedInputTokens !== null
        ? Math.max(
            usage.promptTokens -
              usage.cachedInputTokens -
              (openai || openrouter ? (usage.cacheWriteTokens ?? 0) : 0),
            0,
          )
        : null,
    output: usage.completionTokens,
    ...(inclusiveOutput
      ? {
          visibleOutput:
            usage.completionTokens !== null && usage.reasoningTokens != null
              ? Math.max(usage.completionTokens - usage.reasoningTokens, 0)
              : null,
          ...(openai || openrouter ? { cacheWriteTokens: usage.cacheWriteTokens ?? null } : {}),
        }
      : {}),
    ...(provider === 'google' || inclusiveOutput
      ? {
          reasoningTokens: usage.reasoningTokens ?? null,
          totalTokens: usage.totalTokens ?? null,
          ...(serviceTier ? { serviceTier } : {}),
        }
      : {}),
    ...(deepseek || openrouter
      ? {
          ...(pricingPeriod ? { pricingPeriod } : {}),
          ...(billingModels ? { billingModels } : {}),
        }
      : {}),
    cachedInput: usage.cachedInputTokens,
    cacheWrite5m: anthropic ? (writes.cacheWrite5mTokens ?? null) : null,
    cacheWrite1h: anthropic ? (writes.cacheWrite1hTokens ?? null) : null,
    cost:
      reportedCostUsd !== null
        ? {
            total: reportedCostUsd,
            input: null,
            output: null,
            cacheRead: null,
            cacheWrite5m: null,
            cacheWrite1h: null,
            reasoning: null,
            cacheWrite: null,
          }
        : cost
          ? {
              total: cost.totalCost,
              input:
                anthropic || openai || openrouter
                  ? (cost.uncachedPromptCost ?? null)
                  : cost.promptCost,
              output:
                (deepseek || openrouter) && usage.reasoningTokens == null
                  ? null
                  : (cost.completionCost ?? null),
              cacheRead: cost.cachedInputCost ?? null,
              cacheWrite5m: anthropic ? (cost.cacheWrite5mCost ?? null) : null,
              cacheWrite1h: anthropic ? (cost.cacheWrite1hCost ?? null) : null,
              reasoning:
                (deepseek || openrouter) && usage.reasoningTokens == null
                  ? null
                  : (cost.reasoningCost ?? null),
              ...(openai || openrouter ? { cacheWrite: cost.cacheWriteCost ?? null } : {}),
            }
          : null,
  }
}

export function readUsageReceipt(debugInfo: unknown): UsageReceipt | null {
  if (!debugInfo || typeof debugInfo !== 'object') return null
  const value = (debugInfo as Record<string, unknown>).usageReceipt
  const result = receiptSchema.safeParse(value)
  return result.success ? result.data : null
}

export function readUsageRequestId(debugInfo: unknown): string | null {
  if (!debugInfo || typeof debugInfo !== 'object') return null
  const receipt = readUsageReceipt(debugInfo)
  if (receipt) return receipt.requestId
  const requestId = (debugInfo as Record<string, unknown>).requestId
  return typeof requestId === 'string' && requestId.length > 0 ? requestId : null
}
