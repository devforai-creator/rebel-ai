import type { Provider } from '@/types/database.types'
import type { ModelDefinition, ModelPricingTier, ProviderDefaults } from './types'

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
      input: 10, // 2x long-context rate for prompts over 272K tokens
      output: 45, // 1.5x long-context rate for prompts over 272K tokens
      cachedInput: 1,
      reasoning: 45,
    },
  },
]

const OPENAI_GPT55_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 5,
      output: 30,
      cachedInput: 0.5, // 90% discount on cached inputs
      reasoning: 30,
    },
  },
]

const OPENAI_GPT54_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 2.5,
      output: 15,
      cachedInput: 0.25, // 90% discount on cached inputs
      reasoning: 15,
    },
  },
]

const OPENAI_GPT52_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 1.75,
      output: 14,
      cachedInput: 0.175, // 90% discount on cached inputs
      reasoning: 14,
    },
  },
]

const OPENAI_GPT51_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 1.25,
      output: 10,
      cachedInput: 0.125,
      reasoning: 10,
    },
  },
]

const GEMINI_3_PRO_PRICING: ModelPricingTier[] = [
  {
    maxPromptTokens: 200_000,
    rates: {
      input: 2,
      output: 12,
      cachedInput: 0.2, // $0.20/M - 10% of input rate
    },
  },
  {
    rates: {
      input: 4,
      output: 18,
      cachedInput: 0.4, // $0.40/M - 10% of input rate (estimated for >200k tier)
    },
  },
]

const GEMINI_35_FLASH_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 1.5,
      output: 9,
      cachedInput: 0.15,
    },
  },
]

const GEMINI_31_FLASH_LITE_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 0.25,
      output: 1.5,
      cachedInput: 0.025,
    },
  },
]

const GEMINI_25_PRO_PRICING: ModelPricingTier[] = [
  {
    maxPromptTokens: 200_000,
    rates: {
      input: 1.25,
      output: 10,
      cachedInput: 0.125, // $0.125/M - 10% of input rate
      reasoning: 10,
    },
  },
  {
    rates: {
      input: 2.5,
      output: 15,
      cachedInput: 0.25, // $0.25/M - 10% of input rate
      reasoning: 15,
    },
  },
]

const GEMINI_3_FLASH_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 0.5,
      output: 3,
      cachedInput: 0.05,
    },
  },
]

const CLAUDE_OPUS_46_PRICING: ModelPricingTier[] = [
  {
    maxPromptTokens: 200_000,
    rates: {
      input: 5,
      output: 25,
      cachedInput: 0.5, // 0.1x base rate for cache reads
    },
  },
  {
    rates: {
      input: 10,
      output: 37.5,
      cachedInput: 1.0, // 0.1x base rate for cache reads (premium tier)
    },
  },
]

const CLAUDE_FABLE_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 10,
      output: 50,
      cachedInput: 1.0, // 0.1x base rate for cache reads
    },
  },
]

const CLAUDE_OPUS_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 5,
      output: 25,
      cachedInput: 0.5, // 0.1x base rate for cache reads
    },
  },
]

const CLAUDE_SONNET_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 3,
      output: 15,
      cachedInput: 0.3, // 0.1x base rate for cache reads
    },
  },
]

const CLAUDE_SONNET_5_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 2,
      output: 10,
      cachedInput: 0.2, // introductory pricing through 2026-08-31
    },
  },
]

const CLAUDE_HAIKU_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 0.8,
      output: 4,
      cachedInput: 0.08, // 0.1x base rate for cache reads
    },
  },
]

const DEEPSEEK_V4_FLASH_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 0.14, // $0.14/M (cache miss)
      output: 0.28, // $0.28/M
      cachedInput: 0.028, // $0.028/M (cache hit) - 5x cheaper
    },
  },
]

const DEEPSEEK_V4_PRO_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 1.74, // $1.74/M (cache miss)
      output: 3.48, // $3.48/M
      cachedInput: 0.145, // $0.145/M (cache hit) - almost 10x cheaper
    },
  },
]

const OPENROUTER_GLM5_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 0.75, // $0.75/M via SiliconFlow FP8
      output: 2.55, // $2.55/M
    },
  },
]

const OPENROUTER_GLM51_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 1.26, // $1.26/M via OpenRouter
      output: 3.96, // $3.96/M
    },
  },
]

const OPENROUTER_GLM52_PRICING: ModelPricingTier[] = [
  {
    rates: {
      input: 1.4, // $1.40/M via OpenRouter
      output: 4.4, // $4.40/M
      cachedInput: 0.26, // $0.26/M cache reads
    },
  },
]

export const MODEL_REGISTRY: readonly ModelDefinition[] = [
  // ===========================================================================
  // Google (Gemini)
  // ===========================================================================
  {
    id: 'gemini-3.5-flash',
    provider: 'google',
    displayName: 'Gemini 3.5 Flash',
    pricing: GEMINI_35_FLASH_PRICING,
    uiVisible: true,
    uiOrder: 1,
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'google',
    displayName: 'Gemini 3.1 Flash-Lite',
    pricing: GEMINI_31_FLASH_LITE_PRICING,
    uiVisible: true,
    uiOrder: 2,
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'google',
    displayName: 'Gemini 3.1 Pro (Preview)',
    pricing: GEMINI_3_PRO_PRICING,
    uiVisible: true,
    uiOrder: 3,
  },
  {
    id: 'gemini-3-pro-preview',
    provider: 'google',
    displayName: 'Gemini 3 Pro (Preview)',
    pricing: GEMINI_3_PRO_PRICING,
    uiVisible: true,
    uiOrder: 4,
  },
  {
    id: 'gemini-3-flash-preview',
    provider: 'google',
    displayName: 'Gemini 3 Flash (Preview)',
    aliases: ['gemini-3.0-flash-preview'],
    pricing: GEMINI_3_FLASH_PRICING,
    uiVisible: true,
    uiOrder: 5,
  },
  {
    id: 'gemini-2.5-pro',
    provider: 'google',
    displayName: 'Gemini 2.5 Pro',
    pricing: GEMINI_25_PRO_PRICING,
    uiVisible: true,
    uiOrder: 6,
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'google',
    displayName: 'Gemini 2.5 Flash',
    uiVisible: true,
    uiOrder: 7,
  },
  {
    id: 'gemini-2.5-flash-lite',
    provider: 'google',
    displayName: 'Gemini 2.5 Flash Lite',
    uiVisible: true,
    uiOrder: 8,
  },
  {
    id: 'gemini-2.0-flash-exp',
    provider: 'google',
    displayName: 'Gemini 2.0 Flash Exp',
    uiVisible: false, // legacy hidden option retained for stored preferences
  },

  // ===========================================================================
  // OpenAI (GPT)
  // ===========================================================================
  {
    id: 'gpt-5.6',
    provider: 'openai',
    displayName: 'GPT-5.6',
    aliases: ['gpt-5.6-sol'],
    pricing: OPENAI_GPT56_PRICING,
    features: {
      promptCaching: 'standard',
      reasoning: true,
    },
    uiVisible: true,
    uiOrder: 1,
  },
  {
    id: 'gpt-5.5',
    provider: 'openai',
    displayName: 'GPT-5.5',
    pricing: OPENAI_GPT55_PRICING,
    features: {
      promptCaching: 'extended',
      reasoning: true,
    },
    uiVisible: true,
    uiOrder: 2,
  },
  {
    id: 'gpt-5.4',
    provider: 'openai',
    displayName: 'GPT-5.4',
    pricing: OPENAI_GPT54_PRICING,
    features: {
      promptCaching: 'extended',
      reasoning: true,
    },
    uiVisible: true,
    uiOrder: 3,
  },
  {
    id: 'gpt-5.2',
    provider: 'openai',
    displayName: 'GPT-5.2',
    pricing: OPENAI_GPT52_PRICING,
    features: {
      promptCaching: 'extended',
      reasoning: true,
    },
    uiVisible: true,
    uiOrder: 4,
  },
  {
    id: 'gpt-5.1-chat-latest',
    provider: 'openai',
    displayName: 'GPT-5.1 Chat (Latest)',
    aliases: ['gpt-5.1', 'gpt-5'],
    pricing: OPENAI_GPT51_PRICING,
    features: {
      promptCaching: 'extended',
      reasoning: true,
    },
    uiVisible: true,
    uiOrder: 5,
  },
  {
    id: 'gpt-5.1',
    provider: 'openai',
    displayName: 'GPT-5.1',
    aliases: ['gpt-5'],
    pricing: OPENAI_GPT51_PRICING,
    features: {
      promptCaching: 'extended',
      reasoning: true,
    },
    uiVisible: true,
    uiOrder: 6,
  },
  {
    id: 'gpt-5',
    provider: 'openai',
    displayName: 'GPT-5',
    pricing: OPENAI_GPT51_PRICING,
    features: {
      promptCaching: 'extended',
      reasoning: true,
    },
    uiVisible: true,
    uiOrder: 7,
  },
  {
    id: 'gpt-4.1',
    provider: 'openai',
    displayName: 'GPT-4.1',
    features: {
      promptCaching: 'standard',
    },
    uiVisible: true,
    uiOrder: 8,
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    features: {
      promptCaching: 'standard',
    },
    uiVisible: false,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    displayName: 'GPT-4o Mini',
    features: {
      promptCaching: 'standard',
    },
    uiVisible: false, // lightweight default for translation/reprocess
  },
  {
    id: 'gpt-5.1-mini',
    provider: 'openai',
    displayName: 'GPT-5.1 Mini',
    aliases: ['gpt-5.1'],
    features: {
      promptCaching: 'extended',
    },
    uiVisible: false,
  },

  // ===========================================================================
  // Anthropic (Claude)
  // ===========================================================================
  {
    id: 'claude-fable-5',
    provider: 'anthropic',
    displayName: 'Claude Fable 5',
    pricing: CLAUDE_FABLE_PRICING,
    uiVisible: true,
    uiOrder: 1,
  },
  {
    id: 'claude-opus-4-8',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.8',
    aliases: ['claude-opus-4.8'],
    pricing: CLAUDE_OPUS_PRICING,
    uiVisible: true,
    uiOrder: 2,
  },
  {
    id: 'claude-opus-4-7',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.7',
    aliases: ['claude-opus-4.7'],
    pricing: CLAUDE_OPUS_PRICING,
    uiVisible: true,
    uiOrder: 3,
  },
  {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.6',
    aliases: ['claude-opus-4.6'],
    pricing: CLAUDE_OPUS_46_PRICING,
    uiVisible: true,
    uiOrder: 4,
  },
  {
    id: 'claude-opus-4-5',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.5',
    aliases: ['claude-opus-4.5'],
    pricing: CLAUDE_OPUS_PRICING,
    uiVisible: true,
    uiOrder: 5,
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 5',
    pricing: CLAUDE_SONNET_5_PRICING,
    uiVisible: true,
    uiOrder: 6,
  },
  {
    id: 'claude-sonnet-4-5',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.5',
    aliases: ['claude-sonnet-4.5'],
    pricing: CLAUDE_SONNET_PRICING,
    uiVisible: true,
    uiOrder: 7,
  },
  {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    aliases: ['claude-haiku-4.5'],
    pricing: CLAUDE_HAIKU_PRICING,
    uiVisible: true,
    uiOrder: 8,
  },
  {
    id: 'claude-3-5-haiku-latest',
    provider: 'anthropic',
    displayName: 'Claude 3.5 Haiku (Latest)',
    aliases: ['claude-3-5-haiku'],
    uiVisible: false, // lightweight default for translation/reprocess
  },

  // ===========================================================================
  // DeepSeek
  // ===========================================================================
  {
    id: 'deepseek-v4-flash',
    provider: 'deepseek',
    displayName: 'DeepSeek V4 Flash',
    pricing: DEEPSEEK_V4_FLASH_PRICING,
    uiVisible: true,
    uiOrder: 1,
  },
  {
    id: 'deepseek-v4-pro',
    provider: 'deepseek',
    displayName: 'DeepSeek V4 Pro',
    pricing: DEEPSEEK_V4_PRO_PRICING,
    uiVisible: true,
    uiOrder: 2,
  },
  // ===========================================================================
  // OpenRouter
  // ===========================================================================
  {
    id: 'z-ai/glm-5.2',
    provider: 'openrouter',
    displayName: 'GLM-5.2',
    pricing: OPENROUTER_GLM52_PRICING,
    features: {
      reasoning: true,
    },
    uiVisible: true,
    uiOrder: 1,
  },
  {
    id: 'z-ai/glm-5.1',
    provider: 'openrouter',
    displayName: 'GLM-5.1',
    pricing: OPENROUTER_GLM51_PRICING,
    uiVisible: true,
    uiOrder: 2,
  },
  {
    id: 'z-ai/glm-5',
    provider: 'openrouter',
    displayName: 'GLM-5',
    pricing: OPENROUTER_GLM5_PRICING,
    uiVisible: true,
    uiOrder: 3,
  },

  // ===========================================================================
  // Voyage (Embeddings)
  // Note: All Voyage 4 models share an embedding space, enabling asymmetric
  // retrieval (e.g., query with voyage-4-lite, search docs with voyage-4-large)
  // ===========================================================================
  {
    id: 'voyage-4-large',
    provider: 'voyage_embeddings',
    displayName: 'Voyage 4 Large (Embeddings)',
    uiVisible: true,
    uiOrder: 1,
  },
  {
    id: 'voyage-4',
    provider: 'voyage_embeddings',
    displayName: 'Voyage 4 (Embeddings)',
    uiVisible: true,
    uiOrder: 2,
  },
  {
    id: 'voyage-4-lite',
    provider: 'voyage_embeddings',
    displayName: 'Voyage 4 Lite (Embeddings)',
    uiVisible: true,
    uiOrder: 3,
  },
  {
    id: 'voyage-3-large',
    provider: 'voyage_embeddings',
    displayName: 'Voyage 3 Large (Legacy)',
    uiVisible: true,
    uiOrder: 4,
  },
] satisfies readonly ModelDefinition[]

export const PROVIDER_DEFAULTS: Record<Provider, ProviderDefaults> = {
  google: {
    defaultModel: 'gemini-2.5-flash',
    lightweightModel: 'gemini-3.1-flash-lite',
  },
  openai: {
    defaultModel: 'gpt-5.5',
    lightweightModel: 'gpt-4o-mini',
  },
  anthropic: {
    defaultModel: 'claude-haiku-4-5',
    lightweightModel: 'claude-3-5-haiku-latest',
  },
  deepseek: {
    defaultModel: 'deepseek-v4-flash',
  },
  openrouter: {
    defaultModel: 'z-ai/glm-5',
  },
  voyage_embeddings: {
    defaultModel: 'voyage-4-large',
  },
} satisfies Record<Provider, ProviderDefaults>
