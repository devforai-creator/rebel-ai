import { defineProviderCatalog } from './helpers'

export const voyageModelCatalog = defineProviderCatalog({
  provider: 'voyage_embeddings',
  defaults: {
    defaultModel: 'voyage-4-large',
  },
  models: [
    {
      id: 'voyage-4-large',
      displayName: 'Voyage 4 Large (Embeddings)',
    },
    {
      id: 'voyage-4',
      displayName: 'Voyage 4 (Embeddings)',
    },
    {
      id: 'voyage-4-lite',
      displayName: 'Voyage 4 Lite (Embeddings)',
    },
    {
      id: 'voyage-3-large',
      displayName: 'Voyage 3 Large (Legacy)',
    },
  ],
})
