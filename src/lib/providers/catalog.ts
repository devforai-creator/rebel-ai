import type { EmbeddingOnlyProvider, LlmProvider, Provider } from '@/types/database.types'

export type ProviderKeyRule = {
  placeholder: string
  hint: string
  description: string
  docsUrl?: string
  pattern: RegExp
  maxLength?: number
}

export type ProviderCatalogEntry = {
  optionLabel: string
  badgeLabel: string
  badgeColor: string
  recommended?: boolean
  supportsLLM: boolean
  apiKeyRule: ProviderKeyRule
}

export const PROVIDER_CATALOG: Record<Provider, ProviderCatalogEntry> = {
  google: {
    optionLabel: 'Google (Gemini)',
    badgeLabel: 'Google',
    badgeColor: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    recommended: true,
    supportsLLM: true,
    apiKeyRule: {
      placeholder: 'AIza... 또는 Google AI Studio API 키',
      hint: 'Google AI Studio → API Keys에서 발급한 Gemini API 키',
      description: 'Google API 키는 공백 없는 영숫자/마침표/하이픈/언더스코어 문자열이어야 합니다.',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
      pattern: /^(?!sk-|sk-ant-|sk-or-|pa-)[0-9A-Za-z._\-]{20,200}$/,
      maxLength: 200,
    },
  },
  openai: {
    optionLabel: 'OpenAI (GPT)',
    badgeLabel: 'OpenAI',
    badgeColor: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    supportsLLM: true,
    apiKeyRule: {
      placeholder: 'sk-... 또는 sk-proj-... (최소 24자)',
      hint: 'OpenAI Dashboard → User API Keys → sk-, sk-proj- 형식의 키',
      description:
        'OpenAI 키는 "sk-" 접두사 이후 영숫자/하이픈/언더스코어 조합으로 이루어져야 합니다.',
      docsUrl: 'https://platform.openai.com/account/api-keys',
      pattern: /^sk-[A-Za-z0-9_\-]{20,200}$/,
      maxLength: 200,
    },
  },
  anthropic: {
    optionLabel: 'Anthropic (Claude)',
    badgeLabel: 'Anthropic',
    badgeColor: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
    supportsLLM: true,
    apiKeyRule: {
      placeholder: 'sk-ant-api03-... (최소 24자)',
      hint: 'Anthropic Console → API keys → sk-ant-로 시작하는 키',
      description:
        'Anthropic 키는 "sk-ant-"로 시작하는 영숫자/하이픈/언더스코어 문자열이어야 합니다.',
      docsUrl: 'https://console.anthropic.com/settings/keys',
      pattern: /^sk-ant-[A-Za-z0-9_\-]{20,200}$/,
      maxLength: 220,
    },
  },
  deepseek: {
    optionLabel: 'DeepSeek',
    badgeLabel: 'DeepSeek',
    badgeColor: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400',
    supportsLLM: true,
    apiKeyRule: {
      placeholder: 'sk-... (32자 이상)',
      hint: 'DeepSeek Platform → API Keys → sk-로 시작하는 키',
      description: 'DeepSeek 키는 "sk-"로 시작하는 영숫자 문자열이어야 합니다.',
      docsUrl: 'https://platform.deepseek.com/api_keys',
      pattern: /^sk-[A-Za-z0-9]{28,100}$/,
      maxLength: 120,
    },
  },
  openrouter: {
    optionLabel: 'OpenRouter',
    badgeLabel: 'OpenRouter',
    badgeColor: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
    supportsLLM: true,
    apiKeyRule: {
      placeholder: 'sk-or-v1-... (최소 24자)',
      hint: 'OpenRouter Dashboard → API Keys → sk-or-로 시작하는 키',
      description: 'OpenRouter 키는 "sk-or-" 접두사로 시작하는 문자열이어야 합니다.',
      docsUrl: 'https://openrouter.ai/settings/keys',
      pattern: /^sk-or-[A-Za-z0-9_\-]{20,200}$/,
      maxLength: 220,
    },
  },
  voyage_embeddings: {
    optionLabel: 'Voyage (Embeddings)',
    badgeLabel: 'Voyage',
    badgeColor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
    supportsLLM: false,
    apiKeyRule: {
      placeholder: 'pa-... (최소 24자)',
      hint: 'Voyage 대시보드 → API Keys → pa-로 시작하는 키',
      description: 'Voyage Embeddings 키는 "pa-"로 시작하는 영숫자 문자열이어야 합니다.',
      docsUrl: 'https://docs.voyageai.com/docs/api-key',
      pattern: /^pa-[A-Za-z0-9_\-]{20,120}$/,
      maxLength: 140,
    },
  },
}

export const PROVIDERS = Object.keys(PROVIDER_CATALOG) as Provider[]

export const LLM_PROVIDERS = PROVIDERS.filter(
  (provider): provider is LlmProvider => PROVIDER_CATALOG[provider].supportsLLM,
)

export const EMBEDDING_ONLY_PROVIDERS = PROVIDERS.filter(
  (provider): provider is EmbeddingOnlyProvider => !PROVIDER_CATALOG[provider].supportsLLM,
)
