import { describe, expect, it } from 'vitest'
import { MODEL_REGISTRY } from '@/lib/models'
import {
  getReasoningControl,
  getReasoningModelKey,
  normalizeReasoningPreferences,
  resolveReasoningSnapshot,
  supportsReasoningPreference,
} from './reasoning'

describe('model reasoning policy', () => {
  it('only offers levels supported by Argon and mandatory-reasoning OpenAI models', () => {
    expect(getReasoningControl('google', 'gemini-4-argon')).toEqual({
      levels: ['low', 'medium', 'high'],
      defaultLevel: 'medium',
    })
    expect(supportsReasoningPreference('google', 'gemini-4-argon', 'none')).toBe(false)
    expect(supportsReasoningPreference('openai', 'gpt-6.1-sol', 'none')).toBe(false)
    expect(supportsReasoningPreference('openai', 'gpt-6-sol', 'none')).toBe(true)
    expect(supportsReasoningPreference('google', 'gemini-2.5-flash', 'low')).toBe(false)
    for (const model of MODEL_REGISTRY) {
      const control = model.features?.reasoningControl
      if (control) expect(control.levels).toContain(control.defaultLevel)
    }
  })

  it('distinguishes model default from explicitly turning reasoning off', () => {
    expect(
      resolveReasoningSnapshot({
        provider: 'openai',
        modelName: 'gpt-5.5',
        preference: 'default',
        legacyEffort: 'high',
      }),
    ).toEqual({ effort: null, source: 'chat' })
    expect(
      resolveReasoningSnapshot({ provider: 'openai', modelName: 'gpt-5.5', preference: 'none' }),
    ).toEqual({ effort: 'none', source: 'chat' })
    expect(() =>
      resolveReasoningSnapshot({
        provider: 'google',
        modelName: 'gemini-4-argon',
        preference: 'none',
      }),
    ).toThrow()
  })

  it('preserves the effective legacy key behavior until overridden', () => {
    expect(
      resolveReasoningSnapshot({ provider: 'openai', modelName: 'gpt-5.5', legacyEffort: 'none' }),
    ).toEqual({ effort: null, source: 'legacy-key' })
    expect(
      resolveReasoningSnapshot({
        provider: 'openai',
        modelName: 'gpt-6.1-sol',
        legacyEffort: 'none',
      }),
    ).toEqual({ effort: 'low', source: 'legacy-key' })
    expect(
      resolveReasoningSnapshot({ provider: 'openai', modelName: 'gpt-5.6', legacyEffort: 'none' }),
    ).toEqual({ effort: 'none', source: 'legacy-key' })
    expect(
      resolveReasoningSnapshot({
        provider: 'google',
        modelName: 'gemini-4-argon',
        legacyEffort: 'high',
      }),
    ).toEqual({ effort: null, source: 'model-default' })
  })

  it('keeps preferences per provider/model and rejects unsupported stored values', () => {
    expect(getReasoningModelKey('openai', 'gpt-5.6-sol')).toBe('openai:gpt-5.6')
    expect(
      normalizeReasoningPreferences({
        'google:gemini-4-argon': 'low',
        'openai:gpt-6.1-sol': 'none',
        'openai:gpt-5.5': 'default',
        'google:gemini-2.5-flash': 'high',
        'openai:gemini-4-argon': 'medium',
      }),
    ).toEqual({ 'google:gemini-4-argon': 'low', 'openai:gpt-5.5': 'default' })
  })
})
