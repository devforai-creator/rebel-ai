import { defineProviderCatalog } from './helpers'

export const deepSeekModelCatalog = defineProviderCatalog({
  provider: 'deepseek',
  defaults: {
    defaultModel: 'deepseek-v4-flash',
  },
  models: [
    {
      id: 'deepseek-v4-flash',
      displayName: 'DeepSeek V4.1 Flash',
      aliases: ['deepseek-flash', 'deepseek-v4-flash-vision-exp'],
      // https://api-docs.deepseek.com/quick_start/pricing/
      pricing: [
        {
          rates: { input: 0.15, output: 0.6, cachedInput: 0.003 },
          peakRates: { input: 0.3, output: 1.2, cachedInput: 0.006 },
        },
      ],
    },
    {
      id: 'deepseek-v4-pro',
      displayName: 'DeepSeek V4 Pro',
      // The runner uses the returned model ID if Pro is routed to Flash.
      pricing: [
        {
          rates: { input: 0.66, output: 1.98, cachedInput: 0.022 },
          peakRates: { input: 1.32, output: 3.96, cachedInput: 0.044 },
        },
      ],
    },
  ],
})
