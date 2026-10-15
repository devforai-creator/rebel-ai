import type { Provider } from '@/types/database.types'

export type ModelId = string

export const MODEL_REASONING_LEVELS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export type ModelReasoningLevel = (typeof MODEL_REASONING_LEVELS)[number]
export type ModelReasoningControl = {
  levels: readonly ModelReasoningLevel[]
  defaultLevel: ModelReasoningLevel
}

export type ModelPricingRateSet = {
  input: number
  output: number
  cachedInput?: number
  cacheWrite?: number
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
  promptCacheMode?: 'explicit'
  promptCacheRetention?: 'omit'
  forwardReasoningEffortNone?: boolean
  minimumReasoningEffort?: 'low'
}

export type ModelFeatures = {
  anthropicThinking?: AnthropicThinkingPolicy
  batchChat?: boolean
  promptCaching?: 'standard' | 'extended' | 'implicit-only'
  promptCacheMinTokens?: number
  reasoning?: boolean
  reasoningControl?: ModelReasoningControl
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
