import { describe, expect, it } from 'vitest'
import { supportsGoogleFlex, normalizeServiceTierPreferences } from './service-tier'
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
        'openai:gpt-5.6': 'flex',
      }),
    ).toEqual({ 'google:gemini-3-flash-preview': 'flex', 'google:gemini-4-argon': 'standard' })
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
