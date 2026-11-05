import { wrapLanguageModel, type LanguageModel } from 'ai'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { getProviderOptions } from '@/lib/llm/provider-options'
import { isReasoningPreference, supportsReasoningPreference } from '@/lib/llm/reasoning'
import type { LlmProvider } from '@/types/database.types'

// Wrap once for every summary, fact-extraction, and regeneration call. Merge at
// invocation time so existing prompt-cache and service-tier options stay intact.
export function withSummaryReasoning({
  model,
  provider,
  modelName,
  preference,
}: {
  model: LanguageModel
  provider: LlmProvider
  modelName: string
  preference: unknown
}): LanguageModel {
  if (
    !isReasoningPreference(preference) ||
    preference === 'default' ||
    !supportsReasoningPreference(provider, modelName, preference)
  ) {
    return model
  }

  const reasoningOptions = getProviderOptions(provider, {
    modelName,
    reasoning: { effort: preference, source: 'summary' },
  })?.[provider]
  if (!reasoningOptions) return model

  return wrapLanguageModel({
    model: model as LanguageModelV2,
    middleware: {
      middlewareVersion: 'v2',
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          [provider]: { ...params.providerOptions?.[provider], ...reasoningOptions },
        },
      }),
    },
  })
}
