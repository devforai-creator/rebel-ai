import { describe, expect, it } from 'vitest'
import {
  supportsGoogleFlex,
  supportsModelFlex,
  resolveModelServiceTier,
  normalizeServiceTierPreferences,
} from './service-tier'
import { mergeChatModelConfigPatch, hasPersistableChatModelConfig } from '@/lib/chat/model-config'

describe('chat service tier preferences', () => {
  it('only offers Flex on models listed by Google, including registered aliases', () => {
    expect(supportsGoogleFlex('google', 'gemini-4-argon')).toBe(true)
    expect(supportsGoogleFlex('google', 'gemini-3.0-flash-preview')).toBe(true)
    expect(supportsGoogleFlex('google', 'gemini-3.7-flash')).toBe(false)
    expect(supportsGoogleFlex('google', 'gemini-3.5-flash')).toBe(false)
    expect(supportsGoogleFlex('openai', 'gpt-5.6')).toBe(false)
  })

  it('canonicalizes model keys and drops unsupported tiers and providers', () => {
    expect(
      normalizeServiceTierPreferences({
        'google:gemini-3.0-flash-preview': 'flex',
        'google:gemini-4-argon': 'standard',
        'google:gemini-3.7-flash': 'flex',
        'google:gemini-2.5-pro': 'priority',
        'openai:gpt-5.6-sol': 'flex',
        'openai:gpt-6-luna': 'standard',
        'openai:gpt-4.1': 'flex',
        'openai:unknown-model': 'standard',
      }),
    ).toEqual({
      'google:gemini-3-flash-preview': 'flex',
      'google:gemini-4-argon': 'standard',
      'openai:gpt-5.6': 'flex',
      'openai:gpt-6-luna': 'standard',
    })
  })

  it('inherits legacy OpenAI tiers until a model explicitly overrides them', () => {
    expect(supportsModelFlex('openai', 'gpt-6-luna')).toBe(true)
    expect(supportsModelFlex('openai', 'gpt-4.1')).toBe(false)
    for (const legacyTier of ['standard', 'flex', 'priority', 'batch'] as const) {
      expect(resolveModelServiceTier({ provider: 'openai', legacyTier })).toBe(legacyTier)
      expect(
        resolveModelServiceTier({ provider: 'openai', legacyTier, preference: 'standard' }),
      ).toBe('standard')
    }
  })

  it('preserves tier selection when unrelated settings change and supports clearing it', () => {
    const current = { serviceTiers: { 'google:gemini-4-argon': 'flex' as const } }
    expect(hasPersistableChatModelConfig(current)).toBe(true)
    expect(
      mergeChatModelConfigPatch(current, { reasoning: { 'google:gemini-4-argon': 'low' } }),
    ).toMatchObject(current)
    expect(mergeChatModelConfigPatch(current, { serviceTiers: null })).toEqual({})
  })
})
