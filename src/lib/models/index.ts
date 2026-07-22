import type { Provider } from '@/types/database.types'
import { MODEL_REGISTRY, PROVIDER_DEFAULTS } from './registry'
import type { ModelDefinition, ModelFeatures, ModelPricingTier } from './types'

export { MODEL_REGISTRY, PROVIDER_DEFAULTS } from './registry'
export { ANTHROPIC_CACHE_MIN_TOKENS } from './catalog/anthropic'
export type {
  AnthropicThinkingPolicy,
  ModelDefinition,
  ModelFeatures,
  ModelMatchRules,
  ModelPricingRateSet,
  ModelPricingTier,
  OpenAIModelPolicy,
} from './types'

type ListOptions = {
  uiOnly?: boolean
}

function normalizeModelName(modelName?: string | null): string {
  return modelName ? modelName.toLowerCase() : ''
}

export function isOpenAIGpt56Model(modelName?: string | null): boolean {
  const normalized = normalizeModelName(modelName).trim()
  return normalized === 'gpt-5.6' || normalized.startsWith('gpt-5.6-')
}

function sortByUiOrder(a: ModelDefinition, b: ModelDefinition): number {
  const orderA = typeof a.uiOrder === 'number' ? a.uiOrder : Number.MAX_SAFE_INTEGER
  const orderB = typeof b.uiOrder === 'number' ? b.uiOrder : Number.MAX_SAFE_INTEGER
  return orderA - orderB
}

function isAliasMatch(entry: ModelDefinition, normalizedTarget: string): boolean {
  if (!entry.aliases || entry.aliases.length === 0) {
    return false
  }
  return entry.aliases.some((alias) => normalizedTarget.includes(alias.toLowerCase()))
}

function isFamilyMatch(entry: ModelDefinition, normalizedTarget: string): boolean {
  const prefixes = entry.matches?.prefixes ?? []
  if (prefixes.some((prefix) => normalizedTarget.startsWith(prefix.toLowerCase()))) {
    return true
  }

  const fragments = entry.matches?.contains ?? []
  return fragments.some((fragment) => normalizedTarget.includes(fragment.toLowerCase()))
}

export function listModelsByProvider(
  provider: Provider,
  options: ListOptions = {},
): ModelDefinition[] {
  const { uiOnly = false } = options
  return MODEL_REGISTRY.filter((model) => {
    if (model.provider !== provider) {
      return false
    }
    if (uiOnly && model.uiVisible === false) {
      return false
    }
    return true
  }).sort(sortByUiOrder)
}

export function listUiModelIdsByProvider(provider: Provider): string[] {
  return listModelsByProvider(provider, { uiOnly: true }).map((model) => model.id)
}

export function findModelDefinition({
  modelName,
  provider,
}: {
  modelName?: string | null
  provider?: Provider
}): ModelDefinition | null {
  const normalized = normalizeModelName(modelName)
  if (!normalized) {
    return null
  }

  const exactMatch = MODEL_REGISTRY.find((entry) => {
    if (provider && entry.provider !== provider) {
      return false
    }
    return entry.id.toLowerCase() === normalized
  })
  if (exactMatch) {
    return exactMatch
  }

  const familyMatch = MODEL_REGISTRY.find((entry) => {
    if (provider && entry.provider !== provider) {
      return false
    }
    return isFamilyMatch(entry, normalized)
  })
  if (familyMatch) {
    return familyMatch
  }

  const aliasMatch = MODEL_REGISTRY.find((entry) => {
    if (provider && entry.provider !== provider) {
      return false
    }
    return isAliasMatch(entry, normalized)
  })

  return aliasMatch ?? null
}

export function getModelFeatures({
  modelName,
  provider,
}: {
  modelName?: string | null
  provider?: Provider
}): ModelFeatures | null {
  const model = findModelDefinition({ modelName, provider })
  return model ? (model.features ?? {}) : null
}

export function getModelPricingTiers({
  provider,
  modelName,
}: {
  provider: Provider
  modelName?: string | null
}): ModelPricingTier[] | null {
  const model = findModelDefinition({ provider, modelName })
  return model?.pricing ?? null
}

export function getDefaultModelForProvider(
  provider: Provider,
  options: { lightweight?: boolean } = {},
): string {
  const defaults = PROVIDER_DEFAULTS[provider]

  if (options.lightweight && defaults?.lightweightModel) {
    return defaults.lightweightModel
  }

  if (defaults?.defaultModel) {
    return defaults.defaultModel
  }

  const candidates = listModelsByProvider(provider, { uiOnly: true })
  if (candidates.length > 0) {
    return candidates[0].id
  }

  return PROVIDER_DEFAULTS.google.defaultModel
}

export function hasReasoningSupport(modelName: string): boolean {
  const model = findModelDefinition({ modelName })
  return model?.features?.reasoning === true
}

export function hasExtendedOpenAICacheRetention(modelName: string): boolean {
  const model = findModelDefinition({ modelName })
  return model?.provider === 'openai' && model.features?.promptCaching === 'extended'
}
