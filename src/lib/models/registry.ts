import type { Provider } from '@/types/database.types'
import { anthropicModelCatalog } from './catalog/anthropic'
import { deepSeekModelCatalog } from './catalog/deepseek'
import { googleModelCatalog } from './catalog/google'
import { openAIModelCatalog } from './catalog/openai'
import { openRouterModelCatalog } from './catalog/openrouter'
import { voyageModelCatalog } from './catalog/voyage'
import type { ModelDefinition, ProviderDefaults } from './types'

export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  ...googleModelCatalog.models,
  ...openAIModelCatalog.models,
  ...anthropicModelCatalog.models,
  ...deepSeekModelCatalog.models,
  ...openRouterModelCatalog.models,
  ...voyageModelCatalog.models,
]

export const PROVIDER_DEFAULTS = {
  google: googleModelCatalog.defaults,
  openai: openAIModelCatalog.defaults,
  anthropic: anthropicModelCatalog.defaults,
  deepseek: deepSeekModelCatalog.defaults,
  openrouter: openRouterModelCatalog.defaults,
  voyage_embeddings: voyageModelCatalog.defaults,
} satisfies Record<Provider, ProviderDefaults>
