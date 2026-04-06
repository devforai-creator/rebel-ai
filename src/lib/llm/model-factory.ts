import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAIWithServiceTier } from '@/lib/openai/service-tier'
import type { ApiServiceTier } from '@/types/database.types'
import type { LanguageModel } from 'ai'

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

type BuildLanguageModelInput = {
  provider: string
  modelName: string
  apiKey: string
  serviceTier?: ApiServiceTier | null
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
      return googleProvider(modelName)
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
