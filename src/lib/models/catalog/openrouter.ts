import { defineProviderCatalog, flatPricing } from './helpers'

export const openRouterModelCatalog = defineProviderCatalog({
  provider: 'openrouter',
  defaults: {
    defaultModel: 'z-ai/glm-5',
  },
  models: [
    {
      id: 'z-ai/glm-5.2',
      displayName: 'GLM-5.2',
      pricing: flatPricing({ input: 1.4, output: 4.4, cachedInput: 0.26 }),
      features: { reasoning: true },
    },
    {
      id: 'z-ai/glm-5.1',
      displayName: 'GLM-5.1',
      pricing: flatPricing({ input: 1.26, output: 3.96 }),
    },
    {
      id: 'z-ai/glm-5',
      displayName: 'GLM-5',
      pricing: flatPricing({ input: 0.75, output: 2.55 }),
    },
  ],
})
