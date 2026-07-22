import { defineProviderCatalog, flatPricing } from './helpers'

export const deepSeekModelCatalog = defineProviderCatalog({
  provider: 'deepseek',
  defaults: {
    defaultModel: 'deepseek-v4-flash',
  },
  models: [
    {
      id: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4 Flash',
      pricing: flatPricing({ input: 0.14, output: 0.28, cachedInput: 0.028 }),
    },
    {
      id: 'deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro',
      pricing: flatPricing({ input: 1.74, output: 3.48, cachedInput: 0.145 }),
    },
  ],
})
