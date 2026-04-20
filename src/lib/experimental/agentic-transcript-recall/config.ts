import type { LlmProvider } from '@/types/database.types'
import {
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_MESSAGES_PER_CALL,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES,
  normalizeChatModelConfig,
  type AgenticTranscriptRecallConfigProvider,
  type ChatModelConfig,
} from '@/lib/chat/model-config'

export const EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV =
  'EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED'
export const AGENTIC_TRANSCRIPT_RECALL_MVP_PROVIDERS = ['openai'] as const
export type AgenticTranscriptRecallMvpProvider =
  (typeof AGENTIC_TRANSCRIPT_RECALL_MVP_PROVIDERS)[number]
export type AgenticTranscriptRecallSkipReason =
  | 'disabled_by_global_flag'
  | 'disabled_in_chat_config'
  | 'provider_not_supported'
  | 'provider_not_allowed'

export type AgenticTranscriptRecallRuntimeConfig = {
  configured: boolean
  globallyEnabled: boolean
  providerSupported: boolean
  providerAllowed: boolean
  enabled: boolean
  skipReason: AgenticTranscriptRecallSkipReason | null
  maxToolCalls: number
  maxMessagesPerCall: number
  maxTotalMessages: number
  providerAllowlist: AgenticTranscriptRecallConfigProvider[]
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

export function isExperimentalAgenticTranscriptRecallGloballyEnabled(): boolean {
  return parseBooleanEnv(process.env[EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV])
}

export function resolveAgenticTranscriptRecallRuntimeConfig({
  modelConfig,
  provider,
}: {
  modelConfig: ChatModelConfig | unknown
  provider: LlmProvider
}): AgenticTranscriptRecallRuntimeConfig {
  const normalizedModelConfig = normalizeChatModelConfig(modelConfig)
  const chatConfig = normalizedModelConfig.experimental?.agenticTranscriptRecall ?? null
  const configured = chatConfig !== null && chatConfig !== undefined
  const globallyEnabled = isExperimentalAgenticTranscriptRecallGloballyEnabled()
  const providerSupported = AGENTIC_TRANSCRIPT_RECALL_MVP_PROVIDERS.includes(
    provider as AgenticTranscriptRecallMvpProvider,
  )
  const providerAllowlist =
    chatConfig?.providerAllowlist?.length && chatConfig.providerAllowlist.length > 0
      ? [...chatConfig.providerAllowlist]
      : [...AGENTIC_TRANSCRIPT_RECALL_MVP_PROVIDERS]
  const providerAllowed = providerAllowlist.includes(
    provider as AgenticTranscriptRecallConfigProvider,
  )
  const chatEnabled = chatConfig?.enabled === true

  let skipReason: AgenticTranscriptRecallSkipReason | null = null
  if (!globallyEnabled) {
    skipReason = 'disabled_by_global_flag'
  } else if (!chatEnabled) {
    skipReason = 'disabled_in_chat_config'
  } else if (!providerSupported) {
    skipReason = 'provider_not_supported'
  } else if (!providerAllowed) {
    skipReason = 'provider_not_allowed'
  }

  return {
    configured,
    globallyEnabled,
    providerSupported,
    providerAllowed,
    enabled: skipReason === null,
    skipReason,
    maxToolCalls: chatConfig?.maxToolCalls ?? DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS,
    maxMessagesPerCall:
      chatConfig?.maxMessagesPerCall ?? DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_MESSAGES_PER_CALL,
    maxTotalMessages:
      chatConfig?.maxTotalMessages ?? DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES,
    providerAllowlist,
  }
}
