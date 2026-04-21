import type { LlmProvider } from '@/types/database.types'
import { CHAT_DELIVERY_MODE_ANTHROPIC_BATCH, type ChatDeliveryMode } from '@/lib/chat/delivery-mode'
import {
  AGENTIC_TRANSCRIPT_RECALL_CONFIG_PROVIDERS,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_MESSAGES_PER_CALL,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOOL_CALLS,
  DEFAULT_AGENTIC_TRANSCRIPT_RECALL_MAX_TOTAL_MESSAGES,
  normalizeChatModelConfig,
  type AgenticTranscriptRecallConfigProvider,
  type ChatModelConfig,
} from '@/lib/chat/model-config'

export const EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED_ENV =
  'EXPERIMENTAL_AGENTIC_TRANSCRIPT_RECALL_ENABLED'
export const AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS =
  AGENTIC_TRANSCRIPT_RECALL_CONFIG_PROVIDERS.filter((provider) => provider !== 'google')
export type AgenticTranscriptRecallSupportedProvider =
  (typeof AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS)[number]
export type AgenticTranscriptRecallSkipReason =
  | 'disabled_by_global_flag'
  | 'disabled_by_chat_override'
  | 'disabled_by_account_default'
  | 'provider_not_supported'
  | 'provider_not_allowed'
  | 'delivery_mode_not_supported'
export type AgenticTranscriptRecallPreferenceSource = 'chat_override' | 'account_default'

export type AgenticTranscriptRecallRuntimeConfig = {
  configured: boolean
  accountDefaultEnabled: boolean
  preferenceSource: AgenticTranscriptRecallPreferenceSource
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
  accountDefaultEnabled,
  provider,
  deliveryMode,
}: {
  modelConfig: ChatModelConfig | unknown
  accountDefaultEnabled: boolean
  provider: LlmProvider
  deliveryMode: ChatDeliveryMode
}): AgenticTranscriptRecallRuntimeConfig {
  const normalizedModelConfig = normalizeChatModelConfig(modelConfig)
  const chatConfig = normalizedModelConfig.experimental?.agenticTranscriptRecall ?? null
  const configured = chatConfig !== null && chatConfig !== undefined
  const preferenceSource: AgenticTranscriptRecallPreferenceSource = configured
    ? 'chat_override'
    : 'account_default'
  const globallyEnabled = isExperimentalAgenticTranscriptRecallGloballyEnabled()
  const providerSupported = AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS.includes(
    provider as AgenticTranscriptRecallSupportedProvider,
  )
  const providerAllowlist =
    chatConfig?.providerAllowlist?.length && chatConfig.providerAllowlist.length > 0
      ? [...chatConfig.providerAllowlist]
      : [...AGENTIC_TRANSCRIPT_RECALL_SUPPORTED_PROVIDERS]
  const providerAllowed = providerAllowlist.includes(
    provider as AgenticTranscriptRecallConfigProvider,
  )
  const effectiveChatEnabled = configured ? chatConfig?.enabled === true : accountDefaultEnabled
  const deliveryModeSupported = !(
    provider === 'anthropic' && deliveryMode === CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
  )

  let skipReason: AgenticTranscriptRecallSkipReason | null = null
  if (!globallyEnabled) {
    skipReason = 'disabled_by_global_flag'
  } else if (configured && chatConfig?.enabled !== true) {
    skipReason = 'disabled_by_chat_override'
  } else if (!configured && !effectiveChatEnabled) {
    skipReason = 'disabled_by_account_default'
  } else if (!providerSupported) {
    skipReason = 'provider_not_supported'
  } else if (!providerAllowed) {
    skipReason = 'provider_not_allowed'
  } else if (!deliveryModeSupported) {
    skipReason = 'delivery_mode_not_supported'
  }

  return {
    configured,
    accountDefaultEnabled,
    preferenceSource,
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
