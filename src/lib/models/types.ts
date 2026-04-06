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

export type ModelFeatures = {
  promptCaching?: 'standard' | 'extended'
  reasoning?: boolean
}

export type ModelDefinition = {
  id: ModelId
  provider: Provider
  displayName: string
  aliases?: string[]
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
