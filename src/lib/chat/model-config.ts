export type AlternateModelsConfig = {
  enabled: boolean
  primaryApiKeyId: string | null
  secondaryApiKeyId: string | null
}

export type ChatMemoryMode = 'summary_window' | 'prefix_live_blocks'

export type ChatMemoryConfig = {
  mode: ChatMemoryMode
  sealEveryMessages?: number
  retainTailMessages?: number
}

export const DEFAULT_CHAT_MEMORY_MODE: ChatMemoryMode = 'summary_window'
export const DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES = 100
export const DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES = 4

export type ChatModelConfig = {
  alternateModels?: AlternateModelsConfig | null
  memory?: ChatMemoryConfig | null
}

export function normalizeChatModelConfig(input: unknown): ChatModelConfig {
  if (!input || typeof input !== 'object') {
    return {}
  }

  const candidate = input as {
    alternateModels?: unknown
    memory?: unknown
  }

  const normalized: ChatModelConfig = {}

  if (candidate.alternateModels && typeof candidate.alternateModels === 'object') {
    const raw = candidate.alternateModels as Record<string, unknown>
    const enabled = raw.enabled === true
    const primaryApiKeyId =
      typeof raw.primaryApiKeyId === 'string' && raw.primaryApiKeyId ? raw.primaryApiKeyId : null
    const secondaryApiKeyId =
      typeof raw.secondaryApiKeyId === 'string' && raw.secondaryApiKeyId
        ? raw.secondaryApiKeyId
        : null

    normalized.alternateModels = {
      enabled,
      primaryApiKeyId,
      secondaryApiKeyId,
    }
  }

  if (candidate.memory && typeof candidate.memory === 'object') {
    const raw = candidate.memory as Record<string, unknown>
    const mode =
      raw.mode === 'prefix_live_blocks' || raw.mode === 'summary_window'
        ? raw.mode
        : DEFAULT_CHAT_MEMORY_MODE
    const sealEveryMessages =
      typeof raw.sealEveryMessages === 'number' &&
      Number.isFinite(raw.sealEveryMessages) &&
      raw.sealEveryMessages >= 1
        ? Math.trunc(raw.sealEveryMessages)
        : undefined
    const retainTailMessages =
      typeof raw.retainTailMessages === 'number' &&
      Number.isFinite(raw.retainTailMessages) &&
      raw.retainTailMessages >= 0
        ? Math.trunc(raw.retainTailMessages)
        : undefined

    normalized.memory = {
      mode,
      sealEveryMessages,
      retainTailMessages,
    }
  }

  return normalized
}

export function resolveChatMemoryConfig(input: unknown): Required<ChatMemoryConfig> {
  const normalized = normalizeChatModelConfig(input)
  const mode = normalized.memory?.mode ?? DEFAULT_CHAT_MEMORY_MODE
  const sealEveryMessages =
    normalized.memory?.sealEveryMessages ?? DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES
  const retainTailMessages =
    normalized.memory?.retainTailMessages ?? DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES

  return {
    mode,
    sealEveryMessages,
    retainTailMessages,
  }
}

export function hasPersistableChatModelConfig(config: ChatModelConfig): boolean {
  const hasAlternate = !!config.alternateModels
  const memory = resolveChatMemoryConfig(config)
  const hasNonDefaultMemory =
    memory.mode !== DEFAULT_CHAT_MEMORY_MODE ||
    memory.sealEveryMessages !== DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES ||
    memory.retainTailMessages !== DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES

  return hasAlternate || hasNonDefaultMemory
}
