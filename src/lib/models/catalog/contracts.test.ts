import { describe, expect, it } from 'vitest'
import { isAnthropicBatchChatSupported } from '@/lib/chat/delivery-mode'
import { getGoogleCacheMinTokens } from '@/lib/llm/google-cache'
import {
  getAnthropicMinCacheTokens,
  getProviderOptions,
  supportsAnthropicAdaptiveThinking,
} from '@/lib/llm/provider-options'
import { estimateUsageCost } from '@/lib/model-pricing'
import {
  findModelDefinition,
  getModelPricingTiers,
  listModelsByProvider,
  MODEL_REGISTRY,
  PROVIDER_DEFAULTS,
} from '@/lib/models'
import type { Provider } from '@/types/database.types'

const PROVIDERS = Object.keys(PROVIDER_DEFAULTS) as Provider[]

describe('model catalog contracts', () => {
  it('round-trips every exact model ID and derives visible order from catalog order', () => {
    for (const provider of PROVIDERS) {
      const providerModels = MODEL_REGISTRY.filter((model) => model.provider === provider)
      const visibleModels = providerModels.filter((model) => model.uiVisible !== false)

      expect(listModelsByProvider(provider, { uiOnly: true })).toEqual(visibleModels)
      expect(visibleModels.map((model) => model.uiOrder)).toEqual(
        visibleModels.map((_, index) => index + 1),
      )

      for (const model of providerModels) {
        expect(findModelDefinition({ provider, modelName: model.id })).toBe(model)
      }
    }
  })

  it('wires every declared pricing table into usage estimation', () => {
    for (const model of MODEL_REGISTRY) {
      const tiers = getModelPricingTiers({
        provider: model.provider,
        modelName: model.id,
      })

      if (!model.pricing) {
        expect(tiers).toBeNull()
        continue
      }

      expect(tiers).toBe(model.pricing)
      const estimate = estimateUsageCost({
        provider: model.provider,
        modelName: model.id,
        promptTokens: 1_000,
        completionTokens: 1_000,
      })
      expect(estimate).not.toBeNull()
      expect(estimate?.promptCost).toBeCloseTo(model.pricing[0].rates.input / 1_000, 10)
      expect(estimate?.completionCost).toBeCloseTo(model.pricing[0].rates.output / 1_000, 10)
    }
  })

  it('drives cache, thinking, and batch behavior from registered capabilities', () => {
    for (const model of MODEL_REGISTRY) {
      const minTokens = model.features?.promptCacheMinTokens
      if (typeof minTokens === 'number' && model.provider === 'google') {
        expect(getGoogleCacheMinTokens(model.id)).toBe(minTokens)
      }
      if (typeof minTokens === 'number' && model.provider === 'anthropic') {
        expect(getAnthropicMinCacheTokens(model.id)).toBe(minTokens)
      }

      if (model.provider === 'anthropic') {
        expect(
          isAnthropicBatchChatSupported({
            provider: model.provider,
            modelName: model.id,
          }),
        ).toBe(model.features?.batchChat === true)
        expect(supportsAnthropicAdaptiveThinking(model.id)).toBe(
          model.features?.anthropicThinking !== undefined,
        )
      }
    }
  })

  it('drives OpenAI request-shape exceptions from registered capabilities', () => {
    for (const model of MODEL_REGISTRY.filter((entry) => entry.provider === 'openai')) {
      const options = getProviderOptions('openai', {
        modelName: model.id,
        promptCacheKey: 'cache-key',
        reasoningEffort: 'none',
      })?.openai
      const policy = model.features?.openai

      expect('promptCacheRetention' in (options ?? {})).toBe(
        policy?.promptCacheRetention !== 'omit',
      )
      expect(options?.reasoningEffort).toBe(policy?.forwardReasoningEffortNone ? 'none' : undefined)
    }
  })
})
