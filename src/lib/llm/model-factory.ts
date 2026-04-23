import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider'
import { createOpenAIWithServiceTier } from '@/lib/openai/service-tier'
import {
  googleCachedContentOwnsRequestContract,
  stripGoogleCachedRequestContractMarker,
} from '@/lib/llm/google-cache'
import type { ApiServiceTier, LlmProvider } from '@/types/database.types'
import { wrapLanguageModel, type LanguageModel } from 'ai'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

type BuildLanguageModelInput = {
  provider: LlmProvider
  modelName: string
  apiKey: string
  serviceTier?: ApiServiceTier | null
}

export function transformGoogleCachedToolCallParams(
  params: LanguageModelV2CallOptions,
): LanguageModelV2CallOptions {
  if (!googleCachedContentOwnsRequestContract(params.providerOptions)) {
    return params
  }

  return {
    ...params,
    prompt: params.prompt.filter((message) => message.role !== 'system'),
    tools: undefined,
    toolChoice: undefined,
    providerOptions: stripGoogleCachedRequestContractMarker(params.providerOptions),
  }
}

function wrapGoogleLanguageModel(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({
    model: model as LanguageModelV2,
    middleware: {
      middlewareVersion: 'v2',
      transformParams: async ({ params }) => transformGoogleCachedToolCallParams(params),
    },
  }) as LanguageModel
}

export function buildLanguageModel({
  provider,
  modelName,
  apiKey,
  serviceTier,
}: BuildLanguageModelInput): LanguageModel {
  switch (provider) {
    case 'google': {
      const googleProvider = createGoogleGenerativeAI({ apiKey })
      return wrapGoogleLanguageModel(googleProvider(modelName))
    }
    case 'openai': {
      const openaiProvider = createOpenAIWithServiceTier({
        apiKey,
        serviceTier,
      })
      return openaiProvider(modelName)
    }
    case 'anthropic': {
      const anthropicProvider = createAnthropic({ apiKey })
      return anthropicProvider(modelName)
    }
    case 'deepseek': {
      const deepseekProvider = createDeepSeek({ apiKey })
      return deepseekProvider(modelName)
    }
    case 'openrouter': {
      const openrouterProvider = createOpenAI({
        apiKey,
        baseURL: OPENROUTER_BASE_URL,
      })
      return openrouterProvider.chat(modelName)
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}
