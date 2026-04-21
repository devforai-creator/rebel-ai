import { SUPPORT_TIER_FEATURES, type SupportTier } from '@/lib/support-tier'
import type { LlmProvider } from '@/types/database.types'

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

export const AGENTIC_TRANSCRIPT_RECALL_CONFIG_PROVIDERS = [
  'google',
  'openai',
  'anthropic',
  'deepseek',
  'openrouter',
] as const satisfies readonly LlmProvider[]
export type AgenticTranscriptRecallConfigProvider =
  (typeof AGENTIC_TRANSCRIPT_RECALL_CONFIG_PROVIDERS)[number]

export type ExperimentalAgenticTranscriptRecallConfig = {
  enabled: boolean
  maxToolCalls?: number
  maxMessagesPerCall?: number
  maxTotalMessages?: number
  providerAllowlist?: AgenticTranscriptRecallConfigProvider[]
}

export type AgenticTranscriptRecallOverrideMode = 'inherit' | 'enabled' | 'disabled'

export type ChatExperimentalConfig = {
  agenticTranscriptRecall?: ExperimentalAgenticTranscriptRecallConfig | null
}

export const DEFAULT_CHAT_MEMORY_MODE: ChatMemoryMode = 'summary_window'
export const OPERATOR_DEFAULT_CHAT_MEMORY_MODE: ChatMemoryMode = 'prefix_live_blocks'
export const DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES = 100
export const DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES = 4
export const DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS = 2
export const DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_MESSAGES_PER_CALL = 12
export const DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES = 20
export const CHAT_MEMORY_MODE_SUPPORT_TIERS: Record<ChatMemoryMode, SupportTier> = {
  summary_window: SUPPORT_TIER_FEATURES.SUMMARY_WINDOW_MEMORY.tier,
  prefix_live_blocks: SUPPORT_TIER_FEATURES.PREFIX_LIVE_BLOCKS_MEMORY.tier,
}

export type ChatModelConfig = {
  alternateModels?: AlternateModelsConfig | null
  memory?: ChatMemoryConfig | null
  experimental?: ChatExperimentalConfig | null
}

function normalizePositiveInteger(value: unknown, minimum = 1): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
    ? Math.trunc(value)
    : undefined
}

function normalizeAgenticTranscriptRecallProviderAllowlist(
  value: unknown,
): AgenticTranscriptRecallConfigProvider[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const filtered = value.filter(
    (entry): entry is AgenticTranscriptRecallConfigProvider =>
      typeof entry === 'string' &&
      AGENTIC_TRANSCRIPT_RECALL_CONFIG_PROVIDERS.includes(
        entry as AgenticTranscriptRecallConfigProvider,
      ),
  )

  if (filtered.length === 0) {
    return undefined
  }

  return Array.from(new Set(filtered))
}

export function normalizeChatModelConfig(input: unknown): ChatModelConfig {
  if (!input || typeof input !== 'object') {
    return {}
  }

  const candidate = input as {
    alternateModels?: unknown
    memory?: unknown
    experimental?: unknown
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

  if (Object.prototype.hasOwnProperty.call(candidate, 'experimental')) {
    if (candidate.experimental === null) {
      normalized.experimental = null
    } else if (candidate.experimental && typeof candidate.experimental === 'object') {
      const rawExperimental = candidate.experimental as Record<string, unknown>
      const nextExperimental: ChatExperimentalConfig = {}

      if (Object.prototype.hasOwnProperty.call(rawExperimental, 'agenticTranscriptRecall')) {
        const rawRecall = rawExperimental.agenticTranscriptRecall

        if (rawRecall === null) {
          nextExperimental.agenticTranscriptRecall = null
        } else if (rawRecall && typeof rawRecall === 'object') {
          const raw = rawRecall as Record<string, unknown>

          nextExperimental.agenticTranscriptRecall = {
            enabled: raw.enabled === true,
            maxToolCalls: normalizePositiveInteger(raw.maxToolCalls),
            maxMessagesPerCall: normalizePositiveInteger(raw.maxMessagesPerCall),
            maxTotalMessages: normalizePositiveInteger(raw.maxTotalMessages),
            providerAllowlist: normalizeAgenticTranscriptRecallProviderAllowlist(
              raw.providerAllowlist,
            ),
          }
        }
      }

      if (Object.keys(nextExperimental).length > 0) {
        normalized.experimental = nextExperimental
      }
    }
  }

  return normalized
}

export function resolveChatMemoryConfig(
  input: unknown,
  options?: { defaultMode?: ChatMemoryMode },
): Required<ChatMemoryConfig> {
  const normalized = normalizeChatModelConfig(input)
  const mode = normalized.memory?.mode ?? options?.defaultMode ?? DEFAULT_CHAT_MEMORY_MODE
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

export function buildOperatorDefaultChatModelConfig(input: unknown): ChatModelConfig {
  const normalized = normalizeChatModelConfig(input)
  const memory = resolveChatMemoryConfig(normalized, {
    defaultMode: OPERATOR_DEFAULT_CHAT_MEMORY_MODE,
  })

  return {
    ...normalized,
    memory: {
      mode: memory.mode,
      sealEveryMessages: memory.sealEveryMessages,
      retainTailMessages: memory.retainTailMessages,
    },
  }
}

export function buildOperatorDefaultPersistedChatModelConfig(input: unknown): ChatModelConfig {
  return buildOperatorDefaultChatModelConfig(input)
}

export function resolveAgenticTranscriptRecallOverrideMode(
  input: ChatModelConfig | unknown,
): AgenticTranscriptRecallOverrideMode {
  const normalized = normalizeChatModelConfig(input)
  const agenticTranscriptRecall = normalized.experimental?.agenticTranscriptRecall

  if (agenticTranscriptRecall === null || agenticTranscriptRecall === undefined) {
    return 'inherit'
  }

  return agenticTranscriptRecall.enabled ? 'enabled' : 'disabled'
}

export function hasPersistableChatModelConfig(config: ChatModelConfig): boolean {
  const hasAlternate = !!config.alternateModels
  const memory = resolveChatMemoryConfig(config)
  const hasNonDefaultMemory =
    memory.mode !== DEFAULT_CHAT_MEMORY_MODE ||
    memory.sealEveryMessages !== DEFAULT_PREFIX_LIVE_BLOCKS_SEAL_EVERY_MESSAGES ||
    memory.retainTailMessages !== DEFAULT_PREFIX_LIVE_BLOCKS_RETAIN_TAIL_MESSAGES
  const agenticTranscriptRecall = config.experimental?.agenticTranscriptRecall
  const hasCustomAgenticTranscriptRecallBudget =
    (agenticTranscriptRecall?.maxToolCalls !== undefined &&
      agenticTranscriptRecall.maxToolCalls !== DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS) ||
    (agenticTranscriptRecall?.maxMessagesPerCall !== undefined &&
      agenticTranscriptRecall.maxMessagesPerCall !==
        DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_MESSAGES_PER_CALL) ||
    (agenticTranscriptRecall?.maxTotalMessages !== undefined &&
      agenticTranscriptRecall.maxTotalMessages !==
        DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES)
  const hasExperimentalAgenticTranscriptRecall =
    agenticTranscriptRecall !== null &&
    agenticTranscriptRecall !== undefined &&
    (agenticTranscriptRecall.enabled === true ||
      agenticTranscriptRecall.enabled === false ||
      hasCustomAgenticTranscriptRecallBudget ||
      (agenticTranscriptRecall.providerAllowlist?.length ?? 0) > 0)

  return hasAlternate || hasNonDefaultMemory || hasExperimentalAgenticTranscriptRecall
}
