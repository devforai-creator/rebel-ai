import { describe, expect, it } from 'vitest'

import {
  ANTHROPIC_CACHE_MIN_TOKENS,
  DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT,
  buildAnthropicCacheControl,
  getAnthropicMinCacheTokens,
  getProviderOptions,
  supportsAnthropicAdaptiveThinking,
} from './provider-options'

describe('getProviderOptions', () => {
  it('returns undefined for unsupported providers', () => {
    const options = getProviderOptions('voyage')
    expect(options).toBeUndefined()
  })

  it('returns google safety settings for google provider', () => {
    const options = getProviderOptions('google')

    expect(options).toEqual({
      google: {
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ],
      },
    })
  })

  it('returns undefined for openai provider without prompt cache key', () => {
    const options = getProviderOptions('openai')
    expect(options).toBeUndefined()
  })

  it('returns undefined for openai provider when prompt cache key is empty', () => {
    const options = getProviderOptions('openai', { promptCacheKey: '' })
    expect(options).toBeUndefined()
  })

  it('sets default openai prompt cache retention to 24h', () => {
    const options = getProviderOptions('openai', {
      promptCacheKey: 'cache-key',
    })

    expect(options).toEqual({
      openai: {
        promptCacheKey: 'cache-key',
        promptCacheRetention: '24h',
      },
    })
  })

  it('uses explicit openai prompt cache retention override', () => {
    const options = getProviderOptions('openai', {
      promptCacheKey: 'cache-key',
      promptCacheRetention: 'in_memory',
    })

    expect(options).toEqual({
      openai: {
        promptCacheKey: 'cache-key',
        promptCacheRetention: 'in_memory',
      },
    })
  })

  it('passes reasoningEffort to openai provider options', () => {
    const options = getProviderOptions('openai', {
      reasoningEffort: 'high',
    })

    expect(options).toEqual({
      openai: {
        reasoningEffort: 'high',
      },
    })
  })

  it('omits reasoningEffort when set to none', () => {
    const options = getProviderOptions('openai', {
      reasoningEffort: 'none',
    })

    expect(options).toBeUndefined()
  })

  it('omits reasoningEffort when null', () => {
    const options = getProviderOptions('openai', {
      reasoningEffort: null,
    })

    expect(options).toBeUndefined()
  })

  it('combines reasoningEffort with prompt cache options', () => {
    const options = getProviderOptions('openai', {
      promptCacheKey: 'cache-key',
      reasoningEffort: 'medium',
    })

    expect(options).toEqual({
      openai: {
        promptCacheKey: 'cache-key',
        promptCacheRetention: '24h',
        reasoningEffort: 'medium',
      },
    })
  })

  it('enables adaptive thinking for supported anthropic models', () => {
    const options = getProviderOptions('anthropic', {
      modelName: 'claude-opus-4-7',
    })

    expect(options).toEqual({
      anthropic: {
        thinking: {
          type: 'adaptive',
        },
        effort: DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT,
      },
    })
  })

  it('passes reasoningEffort through as anthropic effort when adaptive thinking is enabled', () => {
    const options = getProviderOptions('anthropic', {
      modelName: 'claude-opus-4-7',
      reasoningEffort: 'medium',
    })

    expect(options).toEqual({
      anthropic: {
        thinking: {
          type: 'adaptive',
        },
        effort: 'medium',
      },
    })
  })

  it('does not enable adaptive thinking for unsupported anthropic models', () => {
    const options = getProviderOptions('anthropic', {
      modelName: 'claude-opus-4-5',
    })

    expect(options).toBeUndefined()
  })
})

describe('buildAnthropicCacheControl', () => {
  it('returns default ephemeral cache control for 5m', () => {
    expect(buildAnthropicCacheControl()).toEqual({
      cacheControl: { type: 'ephemeral' },
    })
    expect(buildAnthropicCacheControl('5m')).toEqual({
      cacheControl: { type: 'ephemeral' },
    })
  })

  it('returns explicit 1h ttl cache control', () => {
    expect(buildAnthropicCacheControl('1h')).toEqual({
      cacheControl: { type: 'ephemeral', ttl: '1h' },
    })
  })
})

describe('getAnthropicMinCacheTokens', () => {
  it('returns haiku 4.5 minimum tokens and is case-insensitive', () => {
    expect(getAnthropicMinCacheTokens('Claude-HAIKU-4-5')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.haiku)
  })

  it('returns legacy haiku minimum tokens for 3.x models', () => {
    expect(getAnthropicMinCacheTokens('Claude-3.5-HAIKU')).toBe(
      ANTHROPIC_CACHE_MIN_TOKENS.haikuLegacy,
    )
  })

  it('returns sonnet minimum tokens', () => {
    expect(getAnthropicMinCacheTokens('claude-3-7-sonnet')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.sonnet)
  })

  it('returns opus 4.5+ minimum tokens', () => {
    expect(getAnthropicMinCacheTokens('claude-opus-4-6')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.opus)
    expect(getAnthropicMinCacheTokens('claude-opus-4-7')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.opus)
  })

  it('returns legacy opus minimum tokens', () => {
    expect(getAnthropicMinCacheTokens('claude-opus-4-1')).toBe(
      ANTHROPIC_CACHE_MIN_TOKENS.opusLegacy,
    )
  })

  it('falls back to most restrictive minimum for unknown models', () => {
    expect(getAnthropicMinCacheTokens('claude-unknown')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.haiku)
  })
})

describe('supportsAnthropicAdaptiveThinking', () => {
  it('supports current adaptive-thinking Anthropic models and aliases', () => {
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4-7')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4.7')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4-6')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-sonnet-4-6')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-mythos-preview')).toBe(true)
  })

  it('rejects older anthropic models without adaptive thinking support', () => {
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4-5')).toBe(false)
    expect(supportsAnthropicAdaptiveThinking('claude-sonnet-4-5')).toBe(false)
    expect(supportsAnthropicAdaptiveThinking('claude-3-7-sonnet')).toBe(false)
  })
})
