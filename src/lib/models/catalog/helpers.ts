import type { Provider } from '@/types/database.types'
import type {
  ModelDefinition,
  ModelPricingRateSet,
  ModelPricingTier,
  ProviderDefaults,
} from '../types'

type ProviderModelDefinition = Omit<ModelDefinition, 'provider' | 'uiOrder' | 'uiVisible'> & {
  uiVisible?: boolean
}

type ProviderCatalogInput = {
  provider: Provider
  defaults: ProviderDefaults
  models: readonly ProviderModelDefinition[]
}

export type ProviderModelCatalog = {
  provider: Provider
  defaults: ProviderDefaults
  models: readonly ModelDefinition[]
}

export function flatPricing(rates: ModelPricingRateSet): ModelPricingTier[] {
  return [{ rates }]
}

export function defineProviderCatalog({
  provider,
  defaults,
  models,
}: ProviderCatalogInput): ProviderModelCatalog {
  let nextUiOrder = 1
  const definitions = models.map<ModelDefinition>((model) => {
    const uiVisible = model.uiVisible ?? true

    return {
      ...model,
      provider,
      uiVisible,
      ...(uiVisible ? { uiOrder: nextUiOrder++ } : {}),
    }
  })

  const modelIds = new Set(definitions.map((model) => model.id))
  if (modelIds.size !== definitions.length) {
    throw new Error(`Duplicate model ID registered for ${provider}`)
  }
  if (!modelIds.has(defaults.defaultModel)) {
    throw new Error(`Default model ${defaults.defaultModel} is not registered for ${provider}`)
  }
  if (defaults.lightweightModel && !modelIds.has(defaults.lightweightModel)) {
    throw new Error(
      `Lightweight model ${defaults.lightweightModel} is not registered for ${provider}`,
    )
  }

  return {
    provider,
    defaults,
    models: definitions,
  }
}
