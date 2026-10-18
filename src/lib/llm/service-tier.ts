import { findModelDefinition, getModelFeatures } from '@/lib/models'
import type { ApiServiceTier, LlmProvider } from '@/types/database.types'

export type ModelServiceTier = 'standard' | 'flex'
export type GoogleServiceTier = ModelServiceTier
export type ChatServiceTierPreferences = Record<string, ModelServiceTier>

export function isGoogleServiceTier(value: unknown): value is GoogleServiceTier {
  return value === 'standard' || value === 'flex'
}

export function supportsGoogleFlex(provider: LlmProvider, modelName: string): boolean {
  return provider === 'google' && getModelFeatures({ provider, modelName })?.flex === true
}

export const isModelServiceTier = isGoogleServiceTier

export function supportsModelFlex(provider: LlmProvider, modelName: string): boolean {
  return (
    (provider === 'openai' || provider === 'google') &&
    getModelFeatures({ provider, modelName })?.flex === true
  )
}

export function supportsModelServiceTier(
  provider: LlmProvider,
  modelName: string,
  tier: ModelServiceTier,
): boolean {
  if (tier === 'flex') return supportsModelFlex(provider, modelName)
  return provider === 'openai' || provider === 'google'
}

export function resolveModelServiceTier({
  provider,
  preference,
  legacyTier,
}: {
  provider: LlmProvider
  preference?: ModelServiceTier
  legacyTier?: ApiServiceTier | null
}): ApiServiceTier | undefined {
  if (provider === 'google') return preference ?? 'standard'
  if (provider === 'openai') return preference ?? legacyTier ?? 'standard'
  return undefined
}

export function getServiceTierModelKey(provider: LlmProvider, modelName: string): string {
  return `${provider}:${findModelDefinition({ provider, modelName })?.id ?? modelName}`
}

export function normalizeServiceTierPreferences(input: unknown): ChatServiceTierPreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const preferences: ChatServiceTierPreferences = {}
  for (const [key, value] of Object.entries(input)) {
    const [provider, ...modelParts] = key.split(':')
    if ((provider !== 'google' && provider !== 'openai') || !isModelServiceTier(value)) continue
    const modelName = modelParts.join(':')
    if (!findModelDefinition({ provider, modelName })) continue
    if (provider === 'google' && !supportsGoogleFlex(provider, modelName)) continue
    if (!supportsModelServiceTier(provider, modelName, value)) continue
    preferences[getServiceTierModelKey(provider, modelName)] = value
  }
  return preferences
}
