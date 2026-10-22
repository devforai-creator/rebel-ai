import { readAnthropicUsageStep } from '@/lib/llm/anthropic-usage'
import { readDeepSeekUsageStep } from '@/lib/llm/deepseek-usage'
import { readGoogleUsageStep } from '@/lib/llm/google-usage'
import { readOpenAIUsageStep } from '@/lib/llm/openai-usage'
import type { SdkUsageStep } from '@/lib/llm/usage'
import { resolveCacheWriteUsage } from './cache-write-usage'
import type { UserDraftUsage } from './user-draft-contract'

export function readUserDraftUsage({
  provider,
  modelName,
  memoryMode,
  step,
  cacheMode,
}: {
  provider: string
  modelName: string
  memoryMode: UserDraftUsage['memoryMode']
  step: SdkUsageStep
  cacheMode?: UserDraftUsage['cacheMode']
}): UserDraftUsage | undefined {
  const usage =
    provider === 'openai'
      ? readOpenAIUsageStep(step)
      : provider === 'anthropic'
        ? readAnthropicUsageStep(step)
        : provider === 'deepseek'
          ? readDeepSeekUsageStep(step)
          : provider === 'google'
            ? readGoogleUsageStep(step)
            : null
  if (!usage) return undefined

  const writes = resolveCacheWriteUsage(usage).cacheWriteTokens ?? null
  // Anthropic input_tokens counts only ordinary input; OpenAI includes reads and writes.
  const inputTokens =
    provider === 'anthropic'
      ? usage.promptTokens !== null && usage.cachedInputTokens !== null && writes !== null
        ? usage.promptTokens + usage.cachedInputTokens + writes
        : null
      : usage.promptTokens
  const cacheHitTokens =
    inputTokens !== null &&
    usage.cachedInputTokens !== null &&
    usage.cachedInputTokens > inputTokens
      ? null
      : usage.cachedInputTokens
  const cacheWriteTokens =
    inputTokens !== null && writes !== null && writes + (cacheHitTokens ?? 0) > inputTokens
      ? null
      : writes

  return {
    provider: provider as UserDraftUsage['provider'],
    modelName: usage.modelName ?? modelName,
    memoryMode,
    inputTokens,
    outputTokens: usage.completionTokens,
    cacheHitTokens,
    // Miss includes newly written tokens. Ordinary input is a separate billing category.
    cacheMissTokens:
      inputTokens !== null && cacheHitTokens !== null ? inputTokens - cacheHitTokens : null,
    ...(provider === 'openai' || provider === 'anthropic'
      ? {
          cacheWriteTokens,
          uncachedInputTokens:
            provider === 'anthropic'
              ? usage.promptTokens
              : inputTokens !== null && cacheHitTokens !== null && cacheWriteTokens !== null
                ? inputTokens - cacheHitTokens - cacheWriteTokens
                : null,
        }
      : {}),
    ...(provider === 'openai' || provider === 'google'
      ? { reasoningTokens: usage.reasoningTokens }
      : {}),
    ...(cacheMode ? { cacheMode } : {}),
  }
}
