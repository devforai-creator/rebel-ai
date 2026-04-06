import type { Provider } from '@/types/database.types'
import { PROVIDER_CATALOG, PROVIDERS } from '@/lib/providers/catalog'

export const MAX_API_KEY_LENGTH = 256

export type ProviderRule = {
  label: string
  recommended?: boolean
  placeholder: string
  hint: string
  description: string
  docsUrl?: string
  pattern: RegExp
  maxLength?: number
}

export const PROVIDER_RULES: Record<Provider, ProviderRule> = PROVIDERS.reduce(
  (acc, provider) => {
    const entry = PROVIDER_CATALOG[provider]
    acc[provider] = {
      label: entry.optionLabel,
      recommended: entry.recommended,
      ...entry.apiKeyRule,
    }
    return acc
  },
  {} as Record<Provider, ProviderRule>,
)

export const PROVIDER_OPTIONS = PROVIDERS.map((value) => ({
  value,
  label: PROVIDER_CATALOG[value].optionLabel,
  recommended: PROVIDER_CATALOG[value].recommended ?? false,
}))
