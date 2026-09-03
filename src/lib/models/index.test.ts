import { describe, it, expect } from 'vitest'
import {
  listModelsByProvider,
  listUiModelIdsByProvider,
  findModelDefinition,
  getModelFeatures,
  getModelPricingTiers,
  getDefaultModelForProvider,
  hasReasoningSupport,
  hasExtendedOpenAICacheRetention,
  isOpenAIGpt56Model,
  supportsRequiredToolChoice,
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
      expect(ids).toContain('gpt-5.6')
      expect(ids).toContain('gpt-5.4')
      expect(ids).toContain('gpt-5.2')
      expect(ids).toContain('gpt-5.1')
    })

    it('excludes non-UI models', () => {
      const ids = listUiModelIdsByProvider('openai')

      // gpt-4o-mini is uiVisible: false (used as lightweight default)
      expect(ids).not.toContain('gpt-4o-mini')
    })

    it('excludes models that are no longer available from their providers', () => {
      const retiredModels = [
        ['google', 'gemini-3-pro-preview'],
        ['google', 'gemini-2.0-flash-exp'],
        ['anthropic', 'claude-3-5-haiku-latest'],
        ['openai', 'gpt-5.1-chat-latest'],
        ['openai', 'gpt-5.1-mini'],
      ] as const

      for (const [provider, modelName] of retiredModels) {
        expect(listModelsByProvider(provider).map((model) => model.id)).not.toContain(modelName)
        expect(findModelDefinition({ provider, modelName })).toBeNull()
      }
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

    it('finds Claude Opus 4.8 by alias', () => {
      const model = findModelDefinition({ modelName: 'claude-opus-4.8' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('claude-opus-4-8')
    })

    it('finds Claude Sonnet 5 by exact ID', () => {
      const model = findModelDefinition({ modelName: 'claude-sonnet-5' })

      expect(model).not.toBeNull()
      expect(model?.provider).toBe('anthropic')
      expect(model?.displayName).toBe('Claude Sonnet 5')
    })

    it('resolves configured model families before broad aliases', () => {
      expect(findModelDefinition({ modelName: 'gpt-5.6-terra' })?.id).toBe('gpt-5.6')
      expect(findModelDefinition({ modelName: 'claude-sonnet-5-20260701' })?.id).toBe(
        'claude-sonnet-5',
      )
      expect(findModelDefinition({ modelName: 'claude-opus-4.8-20260701' })?.id).toBe(
        'claude-opus-4-8',
      )
      expect(findModelDefinition({ modelName: 'claude-fable-5-1-20260831' })?.id).toBe(
        'claude-fable-5-1',
      )
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
        modelName: 'gemini-3.1-pro-preview',
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
      expect(getDefaultModelForProvider('openai')).toBe('gpt-5.5')
      expect(getDefaultModelForProvider('anthropic')).toBe('claude-haiku-4-5')
      expect(getDefaultModelForProvider('deepseek')).toBe('deepseek-v4-flash')
    })

    it('returns lightweight model when requested', () => {
      expect(getDefaultModelForProvider('google', { lightweight: true })).toBe(
        'gemini-3.5-flash-lite',
      )
      expect(getDefaultModelForProvider('openai', { lightweight: true })).toBe('gpt-4o-mini')
      expect(getDefaultModelForProvider('anthropic', { lightweight: true })).toBe(
        'claude-haiku-4-5',
      )
    })

    it('falls back to default when lightweight not defined', () => {
      // DeepSeek has no lightweight model defined
      expect(getDefaultModelForProvider('deepseek', { lightweight: true })).toBe(
        'deepseek-v4-flash',
      )
    })
  })

  describe('Anthropic model registration', () => {
    it('lists Claude Fable 5.1 first in the Anthropic UI model list', () => {
      const ids = listUiModelIdsByProvider('anthropic')

      expect(ids[0]).toBe('claude-fable-5-1')
      expect(ids).toContain('claude-fable-5')
    })

    it('has flat Fable 5.1 pricing and auto-only tool-choice capability', () => {
      const tiers = getModelPricingTiers({
        provider: 'anthropic',
        modelName: 'claude-fable-5-1',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(10)
      expect(tiers![0].rates.output).toBe(50)
      expect(tiers![0].rates.cachedInput).toBe(0.25)
      expect(
        supportsRequiredToolChoice({
          provider: 'anthropic',
          modelName: 'claude-fable-5-1',
        }),
      ).toBe(false)
    })

    it('has flat Fable 5 pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'anthropic',
        modelName: 'claude-fable-5',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(10)
      expect(tiers![0].rates.output).toBe(50)
      expect(tiers![0].rates.cachedInput).toBe(1)
    })

    it('has flat Opus 4.8 pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'anthropic',
        modelName: 'claude-opus-4-8',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(5)
      expect(tiers![0].rates.output).toBe(25)
      expect(tiers![0].rates.cachedInput).toBe(0.5)
    })

    it('has current introductory Sonnet 5 pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'anthropic',
        modelName: 'claude-sonnet-5',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(2)
      expect(tiers![0].rates.output).toBe(10)
      expect(tiers![0].rates.cachedInput).toBe(0.2)
    })
  })

  describe('Gemini 3.8 Flash registration', () => {
    it('is found by exact ID', () => {
      const model = findModelDefinition({ modelName: 'gemini-3.8-flash' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gemini-3.8-flash')
      expect(model?.provider).toBe('google')
    })

    it('has current promotional pricing and cache threshold', () => {
      const tiers = getModelPricingTiers({
        provider: 'google',
        modelName: 'gemini-3.8-flash',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(0.75)
      expect(tiers![0].rates.output).toBe(3.75)
      expect(tiers![0].rates.cachedInput).toBe(0.075)
      expect(
        getModelFeatures({ provider: 'google', modelName: 'gemini-3.8-flash' })
          ?.promptCacheMinTokens,
      ).toBe(4096)
    })

    it('appears first in the Google UI model list without changing the default model', () => {
      const ids = listUiModelIdsByProvider('google')

      expect(ids[0]).toBe('gemini-3.8-flash')
      expect(getDefaultModelForProvider('google')).toBe('gemini-2.5-flash')
    })
  })

  describe('Gemini 3.7 Flash registration', () => {
    it('is found by exact ID', () => {
      const model = findModelDefinition({ modelName: 'gemini-3.7-flash' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gemini-3.7-flash')
      expect(model?.provider).toBe('google')
    })

    it('has current promotional pricing and cache threshold', () => {
      const tiers = getModelPricingTiers({
        provider: 'google',
        modelName: 'gemini-3.7-flash',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(0.75)
      expect(tiers![0].rates.output).toBe(3.75)
      expect(tiers![0].rates.cachedInput).toBe(0.075)
      expect(
        getModelFeatures({ provider: 'google', modelName: 'gemini-3.7-flash' })
          ?.promptCacheMinTokens,
      ).toBe(4096)
    })

    it('appears after Gemini 3.8 Flash without changing the default model', () => {
      const ids = listUiModelIdsByProvider('google')

      expect(ids[0]).toBe('gemini-3.8-flash')
      expect(ids[1]).toBe('gemini-3.7-flash')
      expect(getDefaultModelForProvider('google')).toBe('gemini-2.5-flash')
    })
  })

  describe('Gemini 3.6 Flash registration', () => {
    it('is found by exact ID', () => {
      const model = findModelDefinition({ modelName: 'gemini-3.6-flash' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gemini-3.6-flash')
      expect(model?.provider).toBe('google')
    })

    it('has current promotional pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'google',
        modelName: 'gemini-3.6-flash',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(0.75)
      expect(tiers![0].rates.output).toBe(3.75)
      expect(tiers![0].rates.cachedInput).toBe(0.075)
    })

    it('appears after Gemini 3.7 Flash without changing the default model', () => {
      const ids = listUiModelIdsByProvider('google')

      expect(ids[0]).toBe('gemini-3.8-flash')
      expect(ids[1]).toBe('gemini-3.7-flash')
      expect(ids[2]).toBe('gemini-3.6-flash')
      expect(getDefaultModelForProvider('google')).toBe('gemini-2.5-flash')
    })
  })

  describe('Gemini 3.5 Flash registration', () => {
    it('is found by exact ID', () => {
      const model = findModelDefinition({ modelName: 'gemini-3.5-flash' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gemini-3.5-flash')
      expect(model?.provider).toBe('google')
    })

    it('has correct standard pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'google',
        modelName: 'gemini-3.5-flash',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(1.5)
      expect(tiers![0].rates.output).toBe(9)
      expect(tiers![0].rates.cachedInput).toBe(0.15)
    })

    it('appears after Gemini 3.6 Flash in the Google UI model list', () => {
      const ids = listUiModelIdsByProvider('google')

      expect(ids[2]).toBe('gemini-3.6-flash')
      expect(ids[3]).toBe('gemini-3.5-flash')
    })
  })

  describe('Gemini 3.5 Flash-Lite registration', () => {
    it('is found by exact ID', () => {
      const model = findModelDefinition({ modelName: 'gemini-3.5-flash-lite' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gemini-3.5-flash-lite')
      expect(model?.provider).toBe('google')
    })

    it('has correct standard pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'google',
        modelName: 'gemini-3.5-flash-lite',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(0.3)
      expect(tiers![0].rates.output).toBe(2.5)
      expect(tiers![0].rates.cachedInput).toBe(0.03)
    })

    it('appears near the top of the Google UI model list and backs lightweight defaults', () => {
      const ids = listUiModelIdsByProvider('google')

      expect(ids[0]).toBe('gemini-3.8-flash')
      expect(ids[1]).toBe('gemini-3.7-flash')
      expect(ids[2]).toBe('gemini-3.6-flash')
      expect(ids[3]).toBe('gemini-3.5-flash')
      expect(ids[4]).toBe('gemini-3.5-flash-lite')
      expect(getDefaultModelForProvider('google', { lightweight: true })).toBe(
        'gemini-3.5-flash-lite',
      )
    })
  })

  describe('Gemini 3.1 Flash-Lite registration', () => {
    it('is found by exact ID', () => {
      const model = findModelDefinition({ modelName: 'gemini-3.1-flash-lite' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('gemini-3.1-flash-lite')
      expect(model?.provider).toBe('google')
    })

    it('has correct standard pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'google',
        modelName: 'gemini-3.1-flash-lite',
      })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(1)
      expect(tiers![0].rates.input).toBe(0.25)
      expect(tiers![0].rates.output).toBe(1.5)
      expect(tiers![0].rates.cachedInput).toBe(0.025)
    })

    it('remains available after the newer Flash models', () => {
      const ids = listUiModelIdsByProvider('google')

      expect(ids[5]).toBe('gemini-3.1-flash-lite')
    })
  })

  describe('hasExtendedOpenAICacheRetention', () => {
    it('returns true for GPT-5.x models with extended caching', () => {
      expect(hasExtendedOpenAICacheRetention('gpt-5.2')).toBe(true)
      expect(hasExtendedOpenAICacheRetention('gpt-5.1')).toBe(true)
      expect(hasExtendedOpenAICacheRetention('gpt-5.5')).toBe(true)
      expect(hasExtendedOpenAICacheRetention('gpt-5')).toBe(true)
    })

    it('returns false for older GPT models', () => {
      expect(hasExtendedOpenAICacheRetention('gpt-5.6')).toBe(false)
      expect(hasExtendedOpenAICacheRetention('gpt-4o')).toBe(false)
      expect(hasExtendedOpenAICacheRetention('gpt-4o-mini')).toBe(false)
      expect(hasExtendedOpenAICacheRetention('gpt-4.1')).toBe(false)
    })

    it('returns false for non-OpenAI models', () => {
      expect(hasExtendedOpenAICacheRetention('gemini-3.1-pro-preview')).toBe(false)
      expect(hasExtendedOpenAICacheRetention('claude-opus-4-5')).toBe(false)
    })

    it('returns false for unknown models', () => {
      expect(hasExtendedOpenAICacheRetention('unknown-model')).toBe(false)
    })
  })

  describe('model capabilities', () => {
    it('keeps provider request and delivery policies with the model definition', () => {
      expect(getModelFeatures({ provider: 'anthropic', modelName: 'claude-fable-5' })).toEqual(
        expect.objectContaining({
          anthropicThinking: 'adaptive-always-on',
          batchChat: true,
          promptCacheMinTokens: 512,
        }),
      )
      expect(getModelFeatures({ provider: 'anthropic', modelName: 'claude-fable-5-1' })).toEqual(
        expect.objectContaining({
          anthropicThinking: 'adaptive-always-on',
          batchChat: true,
          promptCacheMinTokens: 512,
          requiredToolChoice: false,
        }),
      )
      expect(
        supportsRequiredToolChoice({ provider: 'anthropic', modelName: 'claude-fable-5' }),
      ).toBe(true)
      expect(getModelFeatures({ provider: 'openai', modelName: 'gpt-5.6-terra' })?.openai).toEqual({
        promptCacheRetention: 'omit',
        forwardReasoningEffortNone: true,
      })
      expect(
        getModelFeatures({ provider: 'google', modelName: 'gemini-3.6-flash' })
          ?.promptCacheMinTokens,
      ).toBe(1024)
    })

    it('returns null when a model is not registered', () => {
      expect(getModelFeatures({ modelName: 'unknown-model' })).toBeNull()
    })
  })

  describe('isOpenAIGpt56Model', () => {
    it('matches the GPT-5.6 alias and family model IDs', () => {
      expect(isOpenAIGpt56Model('gpt-5.6')).toBe(true)
      expect(isOpenAIGpt56Model('GPT-5.6-SOL')).toBe(true)
      expect(isOpenAIGpt56Model('gpt-5.6-terra')).toBe(true)
    })

    it('does not match earlier model generations', () => {
      expect(isOpenAIGpt56Model('gpt-5.5')).toBe(false)
      expect(isOpenAIGpt56Model(null)).toBe(false)
    })
  })

  describe('hasReasoningSupport', () => {
    it('returns true for GPT-5.x models with reasoning', () => {
      expect(hasReasoningSupport('gpt-5.6')).toBe(true)
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
      expect(hasReasoningSupport('gemini-3.1-pro-preview')).toBe(false)
      expect(hasReasoningSupport('claude-opus-4-5')).toBe(false)
    })

    it('returns false for unknown models', () => {
      expect(hasReasoningSupport('unknown-model')).toBe(false)
    })
  })

  describe('GPT 5.6 registration', () => {
    it('is found by the API alias and explicit Sol model ID', () => {
      const aliasModel = findModelDefinition({ modelName: 'gpt-5.6' })
      const solModel = findModelDefinition({ modelName: 'gpt-5.6-sol' })

      expect(aliasModel).not.toBeNull()
      expect(aliasModel?.id).toBe('gpt-5.6')
      expect(aliasModel?.provider).toBe('openai')
      expect(aliasModel?.displayName).toBe('GPT-5.6')
      expect(aliasModel?.features?.promptCaching).toBe('standard')
      expect(solModel?.id).toBe('gpt-5.6')
      expect(hasReasoningSupport('gpt-5.6-sol')).toBe(true)
    })

    it('has standard and long-context pricing tiers', () => {
      const tiers = getModelPricingTiers({ provider: 'openai', modelName: 'gpt-5.6' })
      const solTiers = getModelPricingTiers({ provider: 'openai', modelName: 'gpt-5.6-sol' })

      expect(tiers).not.toBeNull()
      expect(tiers).toHaveLength(2)
      expect(solTiers).toEqual(tiers)
      expect(tiers![0].maxPromptTokens).toBe(272_000)
      expect(tiers![0].rates).toEqual({
        input: 5,
        output: 30,
        cachedInput: 0.5,
        reasoning: 30,
      })
      expect(tiers![1].rates).toEqual({
        input: 10,
        output: 45,
        cachedInput: 1,
        reasoning: 45,
      })
    })

    it('appears first in the UI while keeping GPT-5.5 as the provider default', () => {
      const ids = listUiModelIdsByProvider('openai')

      expect(ids[0]).toBe('gpt-5.6')
      expect(getDefaultModelForProvider('openai')).toBe('gpt-5.5')
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

    it('appears after GPT-5.6 in UI model list', () => {
      const ids = listUiModelIdsByProvider('openai')

      expect(ids[1]).toBe('gpt-5.5')
    })
  })

  describe('Kimi K3 registration', () => {
    it('is found by exact OpenRouter ID', () => {
      const model = findModelDefinition({ modelName: 'moonshotai/kimi-k3' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('moonshotai/kimi-k3')
      expect(model?.provider).toBe('openrouter')
      expect(model?.features?.reasoning).toBe(true)
      expect(model?.features?.promptCaching).toBe('standard')
    })

    it('has correct OpenRouter pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'openrouter',
        modelName: 'moonshotai/kimi-k3',
      })

      expect(tiers).not.toBeNull()
      expect(tiers![0].rates.input).toBe(3)
      expect(tiers![0].rates.output).toBe(15)
      expect(tiers![0].rates.cachedInput).toBe(0.3)
    })

    it('appears first in the OpenRouter UI model list', () => {
      const ids = listUiModelIdsByProvider('openrouter')

      expect(ids[0]).toBe('moonshotai/kimi-k3')
      expect(ids).toContain('z-ai/glm-5.3')
      expect(ids).toContain('z-ai/glm-5.2')
      expect(ids).toContain('z-ai/glm-5.1')
      expect(ids).toContain('z-ai/glm-5')
    })

    it('keeps the existing OpenRouter provider default', () => {
      expect(getDefaultModelForProvider('openrouter')).toBe('z-ai/glm-5')
    })
  })

  describe('GLM 5.3 registration', () => {
    it('is found by exact OpenRouter ID', () => {
      const model = findModelDefinition({ modelName: 'z-ai/glm-5.3' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('z-ai/glm-5.3')
      expect(model?.provider).toBe('openrouter')
      expect(model?.features?.reasoning).toBe(true)
    })

    it('has correct OpenRouter pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'openrouter',
        modelName: 'z-ai/glm-5.3',
      })

      expect(tiers).not.toBeNull()
      expect(tiers![0].rates.input).toBe(1.4)
      expect(tiers![0].rates.output).toBe(4.4)
      expect(tiers![0].rates.cachedInput).toBe(0.26)
    })

    it('appears after Kimi K3 while keeping the existing provider default', () => {
      const ids = listUiModelIdsByProvider('openrouter')

      expect(ids[1]).toBe('z-ai/glm-5.3')
      expect(getDefaultModelForProvider('openrouter')).toBe('z-ai/glm-5')
    })
  })

  describe('GLM 5.2 registration', () => {
    it('is found by exact OpenRouter ID', () => {
      const model = findModelDefinition({ modelName: 'z-ai/glm-5.2' })

      expect(model).not.toBeNull()
      expect(model?.id).toBe('z-ai/glm-5.2')
      expect(model?.provider).toBe('openrouter')
      expect(model?.features?.reasoning).toBe(true)
    })

    it('has correct OpenRouter pricing', () => {
      const tiers = getModelPricingTiers({
        provider: 'openrouter',
        modelName: 'z-ai/glm-5.2',
      })

      expect(tiers).not.toBeNull()
      expect(tiers![0].rates.input).toBe(1.4)
      expect(tiers![0].rates.output).toBe(4.4)
      expect(tiers![0].rates.cachedInput).toBe(0.26)
    })

    it('appears after GLM 5.3 in the OpenRouter UI model list', () => {
      const ids = listUiModelIdsByProvider('openrouter')

      expect(ids[2]).toBe('z-ai/glm-5.2')
      expect(ids).toContain('z-ai/glm-5.1')
      expect(ids).toContain('z-ai/glm-5')
    })

    it('keeps the existing OpenRouter provider default', () => {
      expect(getDefaultModelForProvider('openrouter')).toBe('z-ai/glm-5')
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

    it('appears in the OpenRouter UI model list', () => {
      const ids = listUiModelIdsByProvider('openrouter')

      expect(ids).toContain('z-ai/glm-5.1')
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
