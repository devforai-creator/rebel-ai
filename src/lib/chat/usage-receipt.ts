import { z } from 'zod'
import type { UsageCostBreakdown } from '@/lib/model-pricing'
import type { LlmProvider } from '@/types/database.types'

const count = z.number().finite().nonnegative().nullable()
const receiptSchema = z.object({
  version: z.literal(1),
  requestId: z.string().min(1),
  provider: z.string(),
  modelName: z.string(),
  callCount: z.number().int().positive(),
  input: count,
  uncachedInput: count,
  output: count,
  // Optional for receipts written before Google thinking usage was retained.
  reasoningTokens: count.optional(),
  totalTokens: count.optional(),
  serviceTier: z.enum(['standard', 'flex', 'mixed']).optional(),
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
}: {
  requestId: string
  provider: LlmProvider
  modelName: string
  callCount: number
  serviceTier?: 'standard' | 'flex' | 'mixed'
  usage: {
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
  const writes = (cost?.cacheWrite5mTokens ?? 0) + (cost?.cacheWrite1hTokens ?? 0)
  return {
    version: 1,
    requestId,
    provider,
    modelName,
    callCount,
    input:
      anthropic && usage.promptTokens !== null
        ? usage.promptTokens + (usage.cachedInputTokens ?? 0) + (usage.cacheWriteTokens ?? writes)
        : usage.promptTokens,
    uncachedInput: anthropic
      ? usage.promptTokens
      : provider === 'google' && usage.promptTokens !== null && usage.cachedInputTokens !== null
        ? Math.max(usage.promptTokens - usage.cachedInputTokens, 0)
        : null,
    output: usage.completionTokens,
    ...(provider === 'google'
      ? {
          reasoningTokens: usage.reasoningTokens ?? null,
          totalTokens: usage.totalTokens ?? null,
          ...(serviceTier ? { serviceTier } : {}),
        }
      : {}),
    cachedInput: usage.cachedInputTokens,
    cacheWrite5m: anthropic && cost ? (cost.cacheWrite5mTokens ?? null) : null,
    cacheWrite1h: anthropic && cost ? (cost.cacheWrite1hTokens ?? null) : null,
    cost: cost
      ? {
          total: cost.totalCost,
          input: anthropic ? (cost.uncachedPromptCost ?? null) : cost.promptCost,
          output: cost.completionCost ?? null,
          cacheRead: cost.cachedInputCost ?? null,
          cacheWrite5m: anthropic ? (cost.cacheWrite5mCost ?? null) : null,
          cacheWrite1h: anthropic ? (cost.cacheWrite1hCost ?? null) : null,
          reasoning: cost.reasoningCost ?? null,
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
