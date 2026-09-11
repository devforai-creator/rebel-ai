import { defineProviderCatalog, flatPricing } from './helpers'

export const LOCAL_MODEL_IDS = ['local-rp-base', 'local-rp-step500'] as const

export const localModelCatalog = defineProviderCatalog({
  provider: 'local',
  defaults: { defaultModel: 'local-rp-base' },
  models: LOCAL_MODEL_IDS.map((id) => ({
    id,
    displayName: id === 'local-rp-base' ? '로컬 RP · 원본' : '로컬 RP · FT 2,000행 (step 500)',
    pricing: flatPricing({ input: 0, output: 0 }),
    features: { reasoning: false, requiredToolChoice: false, batchChat: false },
  })),
})
