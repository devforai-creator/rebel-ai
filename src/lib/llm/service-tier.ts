import { findModelDefinition, getModelFeatures } from '@/lib/models'
import type { LlmProvider } from '@/types/database.types'

export type GoogleServiceTier = 'standard' | 'flex'
export type ChatServiceTierPreferences = Record<string, GoogleServiceTier>

export function isGoogleServiceTier(value: unknown): value is GoogleServiceTier {
  return value === 'standard' || value === 'flex'
}

export function supportsGoogleFlex(provider: LlmProvider, modelName: string): boolean {
  return provider === 'google' && getModelFeatures({ provider, modelName })?.flex === true
}

export function getServiceTierModelKey(provider: LlmProvider, modelName: string): string {
  return `${provider}:${findModelDefinition({ provider, modelName })?.id ?? modelName}`
}

export function normalizeServiceTierPreferences(input: unknown): ChatServiceTierPreferences {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const preferences: ChatServiceTierPreferences = {}
  for (const [key, value] of Object.entries(input)) {
    if (!key.startsWith('google:') || !isGoogleServiceTier(value)) continue
    const modelName = key.slice('google:'.length)
    if (!supportsGoogleFlex('google', modelName)) continue
    preferences[getServiceTierModelKey('google', modelName)] = value
  }
  return preferences
}
