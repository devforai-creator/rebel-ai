import { describe, expect, it } from 'vitest'
import { PROVIDER_CATALOG, PROVIDERS } from '@/lib/providers/catalog'
import { LLM_PROVIDERS, isEmbeddingOnlyProvider, isLLMProvider } from './provider-utils'

describe('provider-utils', () => {
  describe('LLM_PROVIDERS export', () => {
    it('matches catalog providers with supportsLLM=true', () => {
      const expected = PROVIDERS.filter((provider) => PROVIDER_CATALOG[provider].supportsLLM)
      expect(LLM_PROVIDERS).toEqual(expected)
    })
  })

  describe('isLLMProvider', () => {
    it('returns catalog-aligned values for known providers', () => {
      for (const provider of PROVIDERS) {
        expect(isLLMProvider(provider)).toBe(PROVIDER_CATALOG[provider].supportsLLM)
      }
    })

    it('treats unknown providers as LLM-capable (forward-compatible)', () => {
      expect(isLLMProvider('future_provider')).toBe(true)
    })
  })

  describe('isEmbeddingOnlyProvider', () => {
    it('returns catalog-aligned values for known providers', () => {
      for (const provider of PROVIDERS) {
        expect(isEmbeddingOnlyProvider(provider)).toBe(!PROVIDER_CATALOG[provider].supportsLLM)
      }
    })

    it('treats unknown providers as non-embedding', () => {
      expect(isEmbeddingOnlyProvider('future_provider')).toBe(false)
    })
  })
})
