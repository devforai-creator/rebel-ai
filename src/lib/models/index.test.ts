import { describe, it, expect } from 'vitest'
import {
  listModelsByProvider,
  listUiModelIdsByProvider,
  findModelDefinition,
  getModelPricingTiers,
  getDefaultModelForProvider,
  hasReasoningSupport,
  hasExtendedOpenAICacheRetention,
  MODEL_REGISTRY,
  PROVIDER_DEFAULTS,
} from './index'

describe('Model Registry', () => {
  describe('listModelsByProvider', () => {
    it('returns all models for a provider', () => {
      const googleModels = listModelsByProvider('google')
      expect(googleModels.length).toBeGreaterThan(0)
      expect(googleModels.every((m) => m.provider === 'google')).toBe(true)
    })

    it('filters to uiVisible models when uiOnly is true', () => {
      const allModels = listModelsByProvider('openai')
      const uiModels = listModelsByProvider('openai', { uiOnly: true })

      expect(uiModels.length).toBeLessThanOrEqual(allModels.length)
      expect(uiModels.every((m) => m.uiVisible !== false)).toBe(true)
    })

    it('sorts by uiOrder', () => {
      const models = listModelsByProvider('google', { uiOnly: true })
      const orders = models.map((m) => m.uiOrder ?? Infinity)

      for (let i = 1; i < orders.length; i++) {
        expect(orders[i]).toBeGreaterThanOrEqual(orders[i - 1])
      }
    })
  })

  describe('listUiModelIdsByProvider', () => {
    it('returns array of model IDs for UI dropdown', () => {
      const ids = listUiModelIdsByProvider('openai')

      expect(Array.isArray(ids)).toBe(true)
      expect(ids.every((id) => typeof id === 'string')).toBe(true)
      expect(ids).toContain('gpt-5.4')
      expect(ids).toContain('gpt-5.2')
      expect(ids).toContain('gpt-5.1')
    })

    it('excludes non-UI models', () => {
      const ids = listUiModelIdsByProvider('openai')

      // gpt-4o-mini is uiVisible: false (used as lightweight default)
      expect(ids).not.toContain('gpt-4o-mini')
    })
  })

  describe('findModelDefinition', () => {
    it('finds model by exact ID', () => {
      const model = findModelDefinition({ modelName: 'gpt-5.2' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gpt-5.2')
      expect(model?.provider).toBe('openai')
    })

    it('finds model by alias', () => {
      const model = findModelDefinition({ modelName: 'claude-opus-4.5' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('claude-opus-4-5')
    })

    it('finds Claude Opus 4.7 by alias', () => {
      const model = findModelDefinition({ modelName: 'claude-opus-4.7' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('claude-opus-4-7')
    })

    it('is case-insensitive', () => {
      const model = findModelDefinition({ modelName: 'GPT-5.2' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gpt-5.2')
    })

    it('returns null for unknown model', () => {
      const model = findModelDefinition({ modelName: 'unknown-model-xyz' })

      expect(model).toBeNull()
    })

    it('filters by provider when specified', () => {
      const withProvider = findModelDefinition({
        modelName: 'gpt-5.2',
        provider: 'openai',
      })
      const wrongProvider = findModelDefinition({
        modelName: 'gpt-5.2',
        provider: 'google',
      })

      expect(withProvider).not.toBeNull()
      expect(wrongProvider).toBeNull()
    })
  })

  describe('getModelPricingTiers', () => {
    it('returns pricing tiers for known model', () => {
      const tiers = getModelPricingTiers({
        provider: 'openai',
        modelName: 'gpt-5.2',
      })

      expect(tiers).not.toBeNull()
      expect(tiers!.length).toBeGreaterThan(0)
      expect(tiers![0].rates.input).toBe(1.75)
      expect(tiers![0].rates.output).toBe(14)
    })

    it('returns tiered pricing for Gemini models', () => {
      const tiers = getModelPricingTiers({
        provider: 'google',
        modelName: 'gemini-3-pro-preview',
      })

      expect(tiers).not.toBeNull()
      expect(tiers!.length).toBe(2) // Two tiers: <=200k and >200k
      expect(tiers![0].maxPromptTokens).toBe(200_000)
    })

    it('returns null for model without pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'google',
        modelName: 'gemini-2.5-flash', // No pricing defined
      })

      expect(tiers).toBeNull()
    })
  })

  describe('getDefaultModelForProvider', () => {
    it('returns default model for each provider', () => {
      expect(getDefaultModelForProvider('google')).toBe('gemini-2.5-flash')
      expect(getDefaultModelForProvider('openai')).toBe('gpt-5.1-chat-latest')
      expect(getDefaultModelForProvider('anthropic')).toBe('claude-haiku-4-5')
      expect(getDefaultModelForProvider('deepseek')).toBe('deepseek-chat')
    })

    it('returns lightweight model when requested', () => {
      expect(getDefaultModelForProvider('google', { lightweight: true })).toBe(
        'gemini-2.0-flash-exp',
      )
      expect(getDefaultModelForProvider('openai', { lightweight: true })).toBe('gpt-4o-mini')
      expect(getDefaultModelForProvider('anthropic', { lightweight: true })).toBe(
        'claude-3-5-haiku-latest',
      )
    })

    it('falls back to default when lightweight not defined', () => {
      // DeepSeek has no lightweight model defined
      expect(getDefaultModelForProvider('deepseek', { lightweight: true })).toBe('deepseek-chat')
    })
  })

  describe('Anthropic model registration', () => {
    it('lists Claude Opus 4.7 first in the Anthropic UI model list', () => {
      const ids = listUiModelIdsByProvider('anthropic')

      expect(ids[0]).toBe('claude-opus-4-7')
    })

    it('has flat Opus 4.7 pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'anthropic',
        modelName: 'claude-opus-4-7',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(5)
      expect(tiers![0].rates.output).toBe(25)
      expect(tiers![0].rates.cachedInput).toBe(0.5)
    })
  })

  describe('hasExtendedOpenAICacheRetention', () => {
    it('returns true for GPT-5.x models with extended caching', () => {
      expect(hasExtendedOpenAICacheRetention('gpt-5.2')).toBe(true)
      expect(hasExtendedOpenAICacheRetention('gpt-5.1')).toBe(true)
      expect(hasExtendedOpenAICacheRetention('gpt-5.1-mini')).toBe(true)
      expect(hasExtendedOpenAICacheRetention('gpt-5')).toBe(true)
    })

    it('returns false for older GPT models', () => {
      expect(hasExtendedOpenAICacheRetention('gpt-4o')).toBe(false)
      expect(hasExtendedOpenAICacheRetention('gpt-4o-mini')).toBe(false)
      expect(hasExtendedOpenAICacheRetention('gpt-4.1')).toBe(false)
    })

    it('returns false for non-OpenAI models', () => {
      expect(hasExtendedOpenAICacheRetention('gemini-3-pro-preview')).toBe(false)
      expect(hasExtendedOpenAICacheRetention('claude-opus-4-5')).toBe(false)
    })

    it('returns false for unknown models', () => {
      expect(hasExtendedOpenAICacheRetention('unknown-model')).toBe(false)
    })
  })

  describe('hasReasoningSupport', () => {
    it('returns true for GPT-5.x models with reasoning', () => {
      expect(hasReasoningSupport('gpt-5.4')).toBe(true)
      expect(hasReasoningSupport('gpt-5.2')).toBe(true)
      expect(hasReasoningSupport('gpt-5.1')).toBe(true)
      expect(hasReasoningSupport('gpt-5')).toBe(true)
    })

    it('returns false for models without reasoning', () => {
      expect(hasReasoningSupport('gpt-4.1')).toBe(false)
      expect(hasReasoningSupport('gpt-4o')).toBe(false)
      expect(hasReasoningSupport('gpt-4o-mini')).toBe(false)
    })

    it('returns false for non-OpenAI models', () => {
      expect(hasReasoningSupport('gemini-3-pro-preview')).toBe(false)
      expect(hasReasoningSupport('claude-opus-4-5')).toBe(false)
    })

    it('returns false for unknown models', () => {
      expect(hasReasoningSupport('unknown-model')).toBe(false)
    })
  })

  describe('GPT 5.4 registration', () => {
    it('is found by exact ID', () => {
      const model = findModelDefinition({ modelName: 'gpt-5.4' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gpt-5.4')
      expect(model?.provider).toBe('openai')
    })

    it('has correct pricing', () => {
      const tiers = getModelPricingTiers({ provider: 'openai', modelName: 'gpt-5.4' })

      expect(tiers).not.toBeNull()
      expect(tiers![0].rates.input).toBe(2.5)
      expect(tiers![0].rates.output).toBe(15)
      expect(tiers![0].rates.cachedInput).toBe(0.25)
      expect(tiers![0].rates.reasoning).toBe(15)
    })

    it('has extended prompt caching and reasoning features', () => {
      const model = findModelDefinition({ modelName: 'gpt-5.4' })

      expect(model?.features?.promptCaching).toBe('extended')
      expect(model?.features?.reasoning).toBe(true)
    })

    it('appears first in UI model list', () => {
      const ids = listUiModelIdsByProvider('openai')

      expect(ids[0]).toBe('gpt-5.4')
    })
  })

  describe('GLM 5.1 registration', () => {
    it('is found by exact OpenRouter ID', () => {
      const model = findModelDefinition({ modelName: 'z-ai/glm-5.1' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('z-ai/glm-5.1')
      expect(model?.provider).toBe('openrouter')
    })

    it('has correct OpenRouter pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'openrouter',
        modelName: 'z-ai/glm-5.1',
      })

      expect(tiers).not.toBeNull()
      expect(tiers![0].rates.input).toBe(1.26)
      expect(tiers![0].rates.output).toBe(3.96)
    })

    it('appears first in the OpenRouter UI model list', () => {
      const ids = listUiModelIdsByProvider('openrouter')

      expect(ids[0]).toBe('z-ai/glm-5.1')
      expect(ids).toContain('z-ai/glm-5')
    })

    it('keeps the existing OpenRouter provider default', () => {
      expect(getDefaultModelForProvider('openrouter')).toBe('z-ai/glm-5')
    })
  })

  describe('registry integrity', () => {
    it('all models have required fields', () => {
      for (const model of MODEL_REGISTRY) {
        expect(model.id).toBeDefined()
        expect(typeof model.id).toBe('string')
        expect(model.provider).toBeDefined()
        expect(model.displayName).toBeDefined()
      }
    })

    it('all provider defaults reference existing models', () => {
      for (const [provider, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
        if (defaults.defaultModel) {
          const model = findModelDefinition({ modelName: defaults.defaultModel })
          expect(model).not.toBeNull()
          expect(model?.provider).toBe(provider)
        }
        if (defaults.lightweightModel) {
          const model = findModelDefinition({
            modelName: defaults.lightweightModel,
          })
          expect(model).not.toBeNull()
          expect(model?.provider).toBe(provider)
        }
      }
    })

    it('no duplicate model IDs', () => {
      const ids = MODEL_REGISTRY.map((m) => m.id)
      const uniqueIds = new Set(ids)
      expect(ids.length).toBe(uniqueIds.size)
    })
  })
})
