import { z } from 'zod'
import { isReasoningPreference, type ReasoningPreference } from '@/lib/llm/reasoning'

export const USER_DRAFT_MAX_INSTRUCTION_LENGTH = 16_000
export const USER_DRAFT_MAX_REQUEST_BYTES = 128_000

export const userDraftRequestSchema = z
  .object({
    apiKeyId: z.string().min(1).max(200),
    modelName: z.string().trim().min(1).max(200),
    instruction: z.string().max(USER_DRAFT_MAX_INSTRUCTION_LENGTH).default(''),
    reasoningEffort: z.custom<ReasoningPreference>(isReasoningPreference).optional(),
    serviceTier: z.enum(['standard', 'flex']).optional(),
  })
  .strict()

export type UserDraftRequest = z.infer<typeof userDraftRequestSchema>

const tokenCount = z.number().int().nonnegative().nullable()

export const userDraftUsageSchema = z.object({
  provider: z.literal('deepseek'),
  modelName: z.string().min(1),
  memoryMode: z.enum(['summary_window', 'prefix_live_blocks']),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheHitTokens: tokenCount,
  cacheMissTokens: tokenCount,
})

export type UserDraftUsage = z.infer<typeof userDraftUsageSchema>
export type UserDraftResponse = { content: string; usage?: UserDraftUsage }
