import { EMBEDDING_ONLY_PROVIDERS, LLM_PROVIDERS, PROVIDERS } from '@/lib/providers/catalog'
import type { LlmProvider, Provider } from '@/types/database.types'

/**
 * Provider type utilities for API key management
 *
 * This module distinguishes between LLM providers (for chat generation)
 * and embedding-only providers (for vector search).
 */
const EMBEDDING_ONLY_PROVIDER_SET = new Set<string>(EMBEDDING_ONLY_PROVIDERS)
const KNOWN_PROVIDER_SET = new Set<string>(PROVIDERS)
const KNOWN_LLM_PROVIDER_SET = new Set<string>(LLM_PROVIDERS)

export { LLM_PROVIDERS }

/**
 * Check if a provider supports LLM (chat generation)
 *
 * Uses a blacklist approach: any provider NOT in EMBEDDING_ONLY_PROVIDERS
 * is assumed to be an LLM provider. This makes the code forward-compatible
 * when new LLM providers are added.
 *
 * @param provider - The provider string from api_keys table
 * @returns true if the provider can be used for chat generation
 *
 * @example
 * isLLMProvider('google') // true
 * isLLMProvider('voyage_embeddings') // false
 */
export function isLLMProvider(provider: string): boolean {
  return !EMBEDDING_ONLY_PROVIDER_SET.has(provider)
}

export function isKnownProvider(provider: string): provider is Provider {
  return KNOWN_PROVIDER_SET.has(provider)
}

export function isKnownLLMProvider(provider: string): provider is LlmProvider {
  return KNOWN_LLM_PROVIDER_SET.has(provider)
}

/**
 * Check if a provider is embedding-only (cannot be used for chat generation)
 *
 * @param provider - The provider string from api_keys table
 * @returns true if the provider is embedding-only
 *
 * @example
 * isEmbeddingOnlyProvider('voyage_embeddings') // true
 * isEmbeddingOnlyProvider('google') // false
 */
export function isEmbeddingOnlyProvider(provider: string): boolean {
  return EMBEDDING_ONLY_PROVIDER_SET.has(provider)
}
