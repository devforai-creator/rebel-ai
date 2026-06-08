import { describe, expect, it } from 'vitest'
import { PROVIDERS } from '@/lib/providers/catalog'
import { PROVIDER_RULES, PROVIDER_OPTIONS, MAX_API_KEY_LENGTH } from './providerRules'

describe('providerRules', () => {
  describe('MAX_API_KEY_LENGTH', () => {
    it('should be 256', () => {
      expect(MAX_API_KEY_LENGTH).toBe(256)
    })
  })

  describe('PROVIDER_OPTIONS', () => {
    it('should include all providers in catalog order', () => {
      const providers = PROVIDER_OPTIONS.map((opt) => opt.value)
      expect(providers).toEqual(PROVIDERS)
    })

    it('should mark google as recommended', () => {
      const google = PROVIDER_OPTIONS.find((opt) => opt.value === 'google')
      expect(google?.recommended).toBe(true)
    })
  })

  describe('Google API key pattern', () => {
    const { pattern } = PROVIDER_RULES.google

    it('accepts valid Google API keys', () => {
      expect(pattern.test('AIzaSyA1234567890abcdefghijklmnopqrstu')).toBe(true)
      expect(pattern.test('AIzaSyB_abc-123_XYZ-789_abcdefghijklmn')).toBe(true)
      expect(pattern.test('AQ.Ab81234567890abcdefghijklmnopqrstu')).toBe(true)
      expect(pattern.test('GEMINI_1234567890abcdef-xyz')).toBe(true)
    })

    it('rejects invalid Google API keys', () => {
      expect(pattern.test('sk-1234567890abcdefghijklmn')).toBe(false) // OpenAI-like prefix
      expect(pattern.test('sk-ant-api03-1234567890abcdef')).toBe(false) // Anthropic-like prefix
      expect(pattern.test('sk-or-v1-1234567890abcdefghijklmn')).toBe(false) // OpenRouter-like prefix
      expect(pattern.test('pa-1234567890abcdefghijklmn')).toBe(false) // Voyage-like prefix
      expect(pattern.test('AIza123')).toBe(false) // Too short
      expect(pattern.test('AQ1234567890abcdef$')).toBe(false) // Invalid character
    })
  })

  describe('OpenAI API key pattern', () => {
    const { pattern } = PROVIDER_RULES.openai

    it('accepts valid OpenAI API keys', () => {
      expect(pattern.test('sk-1234567890abcdefghijklmn')).toBe(true)
      expect(pattern.test('sk-proj-1234567890abcdefghij')).toBe(true)
      expect(pattern.test('sk-abc_def-123_456-789-xyz')).toBe(true)
    })

    it('rejects invalid OpenAI API keys', () => {
      expect(pattern.test('AIza1234567890')).toBe(false) // Wrong prefix
      expect(pattern.test('sk-123')).toBe(false) // Too short
      expect(pattern.test('sk-ant-api03-123456')).toBe(false) // Anthropic format
    })
  })

  describe('Anthropic API key pattern', () => {
    const { pattern } = PROVIDER_RULES.anthropic

    it('accepts valid Anthropic API keys', () => {
      expect(pattern.test('sk-ant-api03-1234567890abcdef')).toBe(true)
      expect(pattern.test('sk-ant-abc_def-123_456-789-xyz')).toBe(true)
    })

    it('rejects invalid Anthropic API keys', () => {
      expect(pattern.test('sk-1234567890abcdefghij')).toBe(false) // OpenAI format
      expect(pattern.test('sk-ant-123')).toBe(false) // Too short
      expect(pattern.test('AIza1234567890')).toBe(false) // Google format
    })
  })

  describe('DeepSeek API key pattern', () => {
    const { pattern } = PROVIDER_RULES.deepseek

    it('accepts valid DeepSeek API keys', () => {
      // 32 chars after sk- (total 35)
      expect(pattern.test('sk-0399c1234567890abcdef1234567dfe6')).toBe(true)
      // 48 chars after sk- (total 51)
      expect(pattern.test('sk-abcdef1234567890abcdef1234567890abcdef12345678')).toBe(true)
    })

    it('rejects invalid DeepSeek API keys', () => {
      expect(pattern.test('sk-123456789012345678901234567')).toBe(false) // Too short (27 after sk-)
      expect(pattern.test('sk-ant-api03-1234567890')).toBe(false) // Anthropic format
      expect(pattern.test('AIza1234567890')).toBe(false) // Google format
      expect(pattern.test('sk-abc_def-123')).toBe(false) // Contains special chars (underscore/hyphen)
    })

    it('rejects keys with special characters', () => {
      // DeepSeek pattern only allows alphanumeric after sk-
      expect(pattern.test('sk-abc_def1234567890123456789012')).toBe(false)
      expect(pattern.test('sk-abc-def1234567890123456789012')).toBe(false)
    })
  })

  describe('Voyage Embeddings API key pattern', () => {
    const { pattern } = PROVIDER_RULES.voyage_embeddings

    it('accepts valid Voyage API keys', () => {
      expect(pattern.test('pa-1234567890abcdefghijklmn')).toBe(true)
      expect(pattern.test('pa-abc_def-123_456-789-xyz')).toBe(true)
    })

    it('rejects invalid Voyage API keys', () => {
      expect(pattern.test('sk-1234567890')).toBe(false) // Wrong prefix
      expect(pattern.test('pa-123')).toBe(false) // Too short
      expect(pattern.test('PA-1234567890abcdefghij')).toBe(false) // Wrong case
    })
  })

  describe('OpenRouter API key pattern', () => {
    const { pattern } = PROVIDER_RULES.openrouter

    it('accepts valid OpenRouter API keys', () => {
      expect(pattern.test('sk-or-v1-1234567890abcdefghijklmn')).toBe(true)
      expect(pattern.test('sk-or-abc_def-123_456-789-xyz')).toBe(true)
    })

    it('rejects invalid OpenRouter API keys', () => {
      expect(pattern.test('sk-1234567890')).toBe(false) // Wrong prefix
      expect(pattern.test('sk-or-123')).toBe(false) // Too short
      expect(pattern.test('pa-1234567890abcdefghij')).toBe(false) // Voyage format
    })
  })

  describe('All providers have required fields', () => {
    const providers = Object.keys(PROVIDER_RULES) as Array<keyof typeof PROVIDER_RULES>

    it.each(providers)('%s has all required fields', (provider) => {
      const rule = PROVIDER_RULES[provider]
      expect(rule.label).toBeDefined()
      expect(rule.placeholder).toBeDefined()
      expect(rule.hint).toBeDefined()
      expect(rule.description).toBeDefined()
      expect(rule.pattern).toBeInstanceOf(RegExp)
    })

    it.each(providers)('%s has docsUrl', (provider) => {
      const rule = PROVIDER_RULES[provider]
      expect(rule.docsUrl).toBeDefined()
      expect(rule.docsUrl).toMatch(/^https?:\/\//)
    })
  })
})
