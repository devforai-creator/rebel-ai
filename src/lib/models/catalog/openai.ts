import type { ModelPricingTier, ModelPricingRateSet } from '../types'
import { defineProviderCatalog, flatPricing } from './helpers'

// Official model pages: >272K charges the entire request at long-context rates.
// Fast/Priority is 2x Standard for the Sol models below; older models need their own rates.
function longContextPricing(rates: ModelPricingRateSet, solPriority = false): ModelPricingTier[] {
  const longRates = {
    input: rates.input * 2,
    output: rates.output * 1.5,
    cachedInput: rates.cachedInput === undefined ? undefined : rates.cachedInput * 2,
    cacheWrite: rates.cacheWrite === undefined ? undefined : rates.cacheWrite * 2,
    reasoning: (rates.reasoning ?? rates.output) * 1.5,
  }
  return [rates, longRates].map((rateSet, index) => ({
    ...(index === 0 ? { maxPromptTokens: 272_000 } : {}),
    rates: rateSet,
    ...(solPriority
      ? {
          priorityRates: {
            input: rateSet.input * 2,
            output: rateSet.output * 2,
            cachedInput: rateSet.cachedInput === undefined ? undefined : rateSet.cachedInput * 2,
            cacheWrite: rateSet.cacheWrite === undefined ? undefined : rateSet.cacheWrite * 2,
            reasoning: (rateSet.reasoning ?? rateSet.output) * 2,
          },
        }
      : {}),
  }))
}

// https://developers.openai.com/api/docs/models/gpt-6.1-sol
const OPENAI_GPT61_SOL_PRICING = longContextPricing(
  { input: 2, output: 10, cachedInput: 0.1, cacheWrite: 2.5, reasoning: 10 },
  true,
)
// https://developers.openai.com/api/docs/models/gpt-6-sol
const OPENAI_GPT6_SOL_PRICING = longContextPricing(
  { input: 2, output: 10, cachedInput: 0.2, cacheWrite: 2.5, reasoning: 10 },
  true,
)
// https://developers.openai.com/api/docs/models/gpt-5.6-sol (promotional rates through at least 2026-11-21)
const OPENAI_GPT56_PRICING = longContextPricing(
  { input: 4, output: 20, cachedInput: 0.4, cacheWrite: 5, reasoning: 20 },
  true,
)

export const openAIModelCatalog = defineProviderCatalog({
  provider: 'openai',
  defaults: {
    defaultModel: 'gpt-5.5',
    lightweightModel: 'gpt-4o-mini',
  },
  models: [
    {
      id: 'gpt-6.1-sol',
      displayName: 'GPT-6.1 Sol',
      matches: { prefixes: ['gpt-6.1-sol-'] },
      pricing: OPENAI_GPT61_SOL_PRICING,
      features: {
        promptCaching: 'standard',
        reasoning: true,
        reasoningControl: {
          levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultLevel: 'medium',
        },
        openai: {
          promptCacheMode: 'explicit',
          promptCacheRetention: 'omit',
          minimumReasoningEffort: 'low',
        },
      },
    },
    {
      id: 'gpt-6-sol',
      displayName: 'GPT-6 Sol',
      matches: { prefixes: ['gpt-6-sol-'] },
      pricing: OPENAI_GPT6_SOL_PRICING,
      features: {
        promptCaching: 'standard',
        reasoning: true,
        reasoningControl: {
          levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          defaultLevel: 'medium',
        },
        openai: {
          promptCacheMode: 'explicit',
          promptCacheRetention: 'omit',
        },
      },
    },
    {
      id: 'gpt-5.6',
      displayName: 'GPT-5.6',
      aliases: ['gpt-5.6-sol'],
      matches: { prefixes: ['gpt-5.6-'] },
      pricing: OPENAI_GPT56_PRICING,
      features: {
        promptCaching: 'standard',
        reasoning: true,
        reasoningControl: {
          levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'],
          defaultLevel: 'medium',
        },
        openai: {
          promptCacheMode: 'explicit',
          promptCacheRetention: 'omit',
          forwardReasoningEffortNone: true,
        },
      },
    },
    {
      id: 'gpt-5.5',
      displayName: 'GPT-5.5',
      pricing: longContextPricing({ input: 5, output: 30, cachedInput: 0.5, reasoning: 30 }),
      features: {
        promptCaching: 'extended',
        reasoning: true,
        reasoningControl: {
          levels: ['none', 'low', 'medium', 'high', 'xhigh'],
          defaultLevel: 'medium',
        },
      },
    },
    {
      id: 'gpt-5.4',
      displayName: 'GPT-5.4',
      pricing: longContextPricing({ input: 2.5, output: 15, cachedInput: 0.25, reasoning: 15 }),
      features: {
        promptCaching: 'extended',
        reasoning: true,
        reasoningControl: {
          levels: ['none', 'low', 'medium', 'high', 'xhigh'],
          defaultLevel: 'none',
        },
      },
    },
    {
      id: 'gpt-5.2',
      displayName: 'GPT-5.2',
      pricing: flatPricing({ input: 1.75, output: 14, cachedInput: 0.175, reasoning: 14 }),
      features: {
        promptCaching: 'extended',
        reasoning: true,
        reasoningControl: {
          levels: ['none', 'low', 'medium', 'high', 'xhigh'],
          defaultLevel: 'none',
        },
      },
    },
    {
      id: 'gpt-5.1',
      displayName: 'GPT-5.1',
      pricing: flatPricing({ input: 1.25, output: 10, cachedInput: 0.125, reasoning: 10 }),
      features: {
        promptCaching: 'extended',
        reasoning: true,
        reasoningControl: { levels: ['none', 'low', 'medium', 'high'], defaultLevel: 'none' },
      },
    },
    {
      id: 'gpt-5',
      displayName: 'GPT-5',
      pricing: flatPricing({ input: 1.25, output: 10, cachedInput: 0.125, reasoning: 10 }),
      features: {
        promptCaching: 'extended',
        reasoning: true,
        reasoningControl: { levels: ['minimal', 'low', 'medium', 'high'], defaultLevel: 'medium' },
      },
    },
    {
      id: 'gpt-4.1',
      displayName: 'GPT-4.1',
      pricing: flatPricing({ input: 2, output: 8, cachedInput: 0.5 }),
      features: { promptCaching: 'standard' },
    },
    {
      id: 'gpt-4o',
      displayName: 'GPT-4o',
      pricing: flatPricing({ input: 2.5, output: 10, cachedInput: 1.25 }),
      features: { promptCaching: 'standard' },
      uiVisible: false,
    },
    {
      id: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      pricing: flatPricing({ input: 0.15, output: 0.6, cachedInput: 0.075 }),
      features: { promptCaching: 'standard' },
      uiVisible: false,
    },
  ],
})
