import type { Provider } from '@/types/database.types'

export type ModelId = string

export type ModelPricingRateSet = {
  input: number
  output: number
  cachedInput?: number
  reasoning?: number
}

export type ModelPricingTier = {
  maxPromptTokens?: number
  rates: ModelPricingRateSet
}

export type AnthropicThinkingPolicy =
  | 'adaptive-supported'
  | 'adaptive-always-on'
  | 'adaptive-default-disabled'

export type OpenAIModelPolicy = {
  promptCacheRetention?: 'omit'
  forwardReasoningEffortNone?: boolean
}

export type ModelFeatures = {
  anthropicThinking?: AnthropicThinkingPolicy
  batchChat?: boolean
  promptCaching?: 'standard' | 'extended'
  promptCacheMinTokens?: number
  reasoning?: boolean
  requiredToolChoice?: boolean
  openai?: OpenAIModelPolicy
}

export type ModelMatchRules = {
  contains?: string[]
  prefixes?: string[]
}

export type ModelDefinition = {
  id: ModelId
  provider: Provider
  displayName: string
  aliases?: string[]
  matches?: ModelMatchRules
  uiVisible?: boolean
  uiOrder?: number
  pricing?: ModelPricingTier[]
  features?: ModelFeatures
}

export type ProviderDefaults = {
  defaultModel: ModelId
  lightweightModel?: ModelId
}

export type ModelRegistry = readonly ModelDefinition[]
