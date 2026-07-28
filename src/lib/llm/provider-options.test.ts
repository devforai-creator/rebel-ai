import { describe, expect, it } from 'vitest'

import {
  ANTHROPIC_CACHE_MIN_TOKENS,
  DEFAULT_OPENAI_TEXT_VERBOSITY,
  MINIMUM_ANTHROPIC_ALWAYS_ON_EFFORT,
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

  it('sets high text verbosity for openai provider by default', () => {
    const options = getProviderOptions('openai')
    expect(options).toEqual({
      openai: {
        textVerbosity: 'high',
      },
    })
  })

  it('sets high text verbosity for openai provider when prompt cache key is empty', () => {
    const options = getProviderOptions('openai', { promptCacheKey: '' })
    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
      },
    })
  })

  it('sets default openai prompt cache retention to 24h', () => {
    const options = getProviderOptions('openai', {
      promptCacheKey: 'cache-key',
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
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
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
        promptCacheKey: 'cache-key',
        promptCacheRetention: 'in_memory',
      },
    })
  })

  it('does not send legacy prompt cache retention for GPT-5.6', () => {
    const options = getProviderOptions('openai', {
      modelName: 'gpt-5.6',
      promptCacheKey: 'cache-key',
      promptCacheRetention: '24h',
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
        promptCacheKey: 'cache-key',
      },
    })
  })

  it('passes reasoningEffort to openai provider options', () => {
    const options = getProviderOptions('openai', {
      reasoningEffort: 'high',
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
        reasoningEffort: 'high',
      },
    })
  })

  it('omits reasoningEffort when set to none', () => {
    const options = getProviderOptions('openai', {
      reasoningEffort: 'none',
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
      },
    })
  })

  it('passes reasoningEffort none explicitly for GPT-5.6', () => {
    const options = getProviderOptions('openai', {
      modelName: 'gpt-5.6',
      reasoningEffort: 'none',
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
        reasoningEffort: 'none',
      },
    })
  })

  it('applies GPT-5.6 provider policy to registered family variants', () => {
    const options = getProviderOptions('openai', {
      modelName: 'gpt-5.6-terra',
      promptCacheKey: 'cache-key',
      promptCacheRetention: '24h',
      reasoningEffort: 'none',
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
        promptCacheKey: 'cache-key',
        reasoningEffort: 'none',
      },
    })
  })

  it('preserves the GPT-5.6 default when the reasoning preference is missing', () => {
    const options = getProviderOptions('openai', {
      modelName: 'gpt-5.6-sol',
      reasoningEffort: null,
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
      },
    })
  })

  it('omits reasoningEffort when null but keeps openai text verbosity', () => {
    const options = getProviderOptions('openai', {
      reasoningEffort: null,
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
      },
    })
  })

  it('combines reasoningEffort with prompt cache options', () => {
    const options = getProviderOptions('openai', {
      promptCacheKey: 'cache-key',
      reasoningEffort: 'medium',
    })

    expect(options).toEqual({
      openai: {
        textVerbosity: DEFAULT_OPENAI_TEXT_VERBOSITY,
        promptCacheKey: 'cache-key',
        promptCacheRetention: '24h',
        reasoningEffort: 'medium',
      },
    })
  })

  it('does not enable optional adaptive thinking for Anthropic models', () => {
    const options = getProviderOptions('anthropic', {
      modelName: 'claude-opus-4-7',
    })

    expect(options).toBeUndefined()
  })

  it('ignores reasoningEffort for optional Anthropic thinking', () => {
    const options = getProviderOptions('anthropic', {
      modelName: 'claude-opus-4-7',
      reasoningEffort: 'medium',
    })

    expect(options).toBeUndefined()
  })

  it('keeps always-on Claude Fable 5 thinking at minimum effort', () => {
    const options = getProviderOptions('anthropic', {
      modelName: 'claude-fable-5',
      reasoningEffort: 'high',
    })

    expect(options).toEqual({
      anthropic: {
        thinking: {
          type: 'adaptive',
        },
        effort: MINIMUM_ANTHROPIC_ALWAYS_ON_EFFORT,
      },
    })
  })

  it('explicitly disables default-on Claude Sonnet 5 thinking', () => {
    const options = getProviderOptions('anthropic', {
      modelName: 'claude-sonnet-5',
      reasoningEffort: 'medium',
    })

    expect(options).toEqual({
      anthropic: {
        thinking: {
          type: 'disabled',
        },
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

  it('returns legacy haiku minimum tokens for Claude 3 models', () => {
    expect(getAnthropicMinCacheTokens('Claude-3-HAIKU')).toBe(
      ANTHROPIC_CACHE_MIN_TOKENS.haikuLegacy,
    )
  })

  it('returns Fable and Mythos minimum tokens', () => {
    expect(getAnthropicMinCacheTokens('claude-fable-5')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.fable)
    expect(getAnthropicMinCacheTokens('claude-mythos-5')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.mythos)
    expect(getAnthropicMinCacheTokens('claude-mythos-preview')).toBe(
      ANTHROPIC_CACHE_MIN_TOKENS.mythosPreview,
    )
  })

  it('returns sonnet minimum tokens', () => {
    expect(getAnthropicMinCacheTokens('claude-3-7-sonnet')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.sonnet)
    expect(getAnthropicMinCacheTokens('claude-sonnet-5')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.sonnet)
  })

  it('returns opus 4.5+ minimum tokens', () => {
    expect(getAnthropicMinCacheTokens('claude-opus-4-6')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.opus)
    expect(getAnthropicMinCacheTokens('claude-opus-4-7')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.opus)
  })

  it('returns the lower Opus 4.8 minimum tokens and supports dotted aliases', () => {
    expect(getAnthropicMinCacheTokens('claude-opus-4-8')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.opus48)
    expect(getAnthropicMinCacheTokens('claude-opus-4.8')).toBe(ANTHROPIC_CACHE_MIN_TOKENS.opus48)
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
    expect(supportsAnthropicAdaptiveThinking('claude-fable-5')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-mythos-5')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4-8')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4.8')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4-7')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4.7')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4-6')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-sonnet-5')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-sonnet-4-6')).toBe(true)
    expect(supportsAnthropicAdaptiveThinking('claude-mythos-preview')).toBe(true)
  })

  it('rejects older anthropic models without adaptive thinking support', () => {
    expect(supportsAnthropicAdaptiveThinking('claude-opus-4-5')).toBe(false)
    expect(supportsAnthropicAdaptiveThinking('claude-sonnet-4-5')).toBe(false)
    expect(supportsAnthropicAdaptiveThinking('claude-3-7-sonnet')).toBe(false)
  })
})
