import type { ModelPricingTier } from '../types'
import { defineProviderCatalog, flatPricing } from './helpers'

const OPENAI_GPT56_PRICING: ModelPricingTier[] = [
  {
    maxPromptTokens: 272_000,
    rates: {
      input: 5,
      output: 30,
      cachedInput: 0.5,
      reasoning: 30,
    },
  },
  {
    rates: {
      input: 10,
      output: 45,
      cachedInput: 1,
      reasoning: 45,
    },
  },
]

export const openAIModelCatalog = defineProviderCatalog({
  provider: 'openai',
  defaults: {
    defaultModel: 'gpt-5.5',
    lightweightModel: 'gpt-4o-mini',
  },
  models: [
    {
      id: 'gpt-5.6',
      displayName: 'GPT-5.6',
      aliases: ['gpt-5.6-sol'],
      matches: { prefixes: ['gpt-5.6-'] },
      pricing: OPENAI_GPT56_PRICING,
      features: {
        promptCaching: 'standard',
        reasoning: true,
        openai: {
          promptCacheRetention: 'omit',
          forwardReasoningEffortNone: true,
        },
      },
    },
    {
      id: 'gpt-5.5',
      displayName: 'GPT-5.5',
      pricing: flatPricing({ input: 5, output: 30, cachedInput: 0.5, reasoning: 30 }),
      features: { promptCaching: 'extended', reasoning: true },
    },
    {
      id: 'gpt-5.4',
      displayName: 'GPT-5.4',
      pricing: flatPricing({ input: 2.5, output: 15, cachedInput: 0.25, reasoning: 15 }),
      features: { promptCaching: 'extended', reasoning: true },
    },
    {
      id: 'gpt-5.2',
      displayName: 'GPT-5.2',
      pricing: flatPricing({ input: 1.75, output: 14, cachedInput: 0.175, reasoning: 14 }),
      features: { promptCaching: 'extended', reasoning: true },
    },
    {
      id: 'gpt-5.1-chat-latest',
      displayName: 'GPT-5.1 Chat (Latest)',
      aliases: ['gpt-5.1', 'gpt-5'],
      pricing: flatPricing({ input: 1.25, output: 10, cachedInput: 0.125, reasoning: 10 }),
      features: { promptCaching: 'extended', reasoning: true },
    },
    {
      id: 'gpt-5.1',
      displayName: 'GPT-5.1',
      aliases: ['gpt-5'],
      pricing: flatPricing({ input: 1.25, output: 10, cachedInput: 0.125, reasoning: 10 }),
      features: { promptCaching: 'extended', reasoning: true },
    },
    {
      id: 'gpt-5',
      displayName: 'GPT-5',
      pricing: flatPricing({ input: 1.25, output: 10, cachedInput: 0.125, reasoning: 10 }),
      features: { promptCaching: 'extended', reasoning: true },
    },
    {
      id: 'gpt-4.1',
      displayName: 'GPT-4.1',
      features: { promptCaching: 'standard' },
    },
    {
      id: 'gpt-4o',
      displayName: 'GPT-4o',
      features: { promptCaching: 'standard' },
      uiVisible: false,
    },
    {
      id: 'gpt-4o-mini',
      displayName: 'GPT-4o Mini',
      features: { promptCaching: 'standard' },
      uiVisible: false,
    },
    {
      id: 'gpt-5.1-mini',
      displayName: 'GPT-5.1 Mini',
      aliases: ['gpt-5.1'],
      features: { promptCaching: 'extended' },
      uiVisible: false,
    },
  ],
})
