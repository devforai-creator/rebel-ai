import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  AgenticTranscriptRecallOverrideMode,
  ChatModelConfig,
  ChatMemoryMode,
} from '@/lib/chat/model-config'
import {
  buildOperatorDefaultChatModelConfig,
  normalizeChatModelConfig,
  resolveAgenticTranscriptRecallOverrideMode,
  resolveChatMemoryConfig,
} from '@/lib/chat/model-config'
import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
  isAnthropicBatchChatEnabled,
  isAnthropicBatchChatSupported,
  type ChatDeliveryMode,
} from '@/lib/chat/delivery-mode'
import { updateChatModelConfig } from '../actions'
import type { ApiKeyOption } from '../utils'

type ResolveInitialChatSettingsArgs = {
  apiKeys: ApiKeyOption[]
  preselectedApiKeyId?: string
  normalizedModelConfig: ReturnType<typeof normalizeChatModelConfig>
  storedApiKeyId?: string | null
}

export type InitialChatSettings = {
  primaryApiKeyId: string
  secondaryApiKeyId: string
  alternateModelsEnabled: boolean
}

function resolveValidApiKeyId(apiKeys: ApiKeyOption[], candidate?: string | null): string | null {
  if (!candidate) {
    return null
  }

  return apiKeys.some((key) => key.id === candidate) ? candidate : null
}

export function resolveInitialChatSettings({
  apiKeys,
  preselectedApiKeyId,
  normalizedModelConfig,
  storedApiKeyId,
}: ResolveInitialChatSettingsArgs): InitialChatSettings {
  const primaryFromConfig = resolveValidApiKeyId(
    apiKeys,
    normalizedModelConfig.alternateModels?.primaryApiKeyId,
  )
  const primaryFromPreselected = resolveValidApiKeyId(apiKeys, preselectedApiKeyId ?? null)
  const primaryFromStored = resolveValidApiKeyId(apiKeys, storedApiKeyId ?? null)
  const primaryApiKeyId =
    primaryFromConfig ?? primaryFromPreselected ?? primaryFromStored ?? apiKeys[0]?.id ?? ''

  const secondaryFromConfig = resolveValidApiKeyId(
    apiKeys,
    normalizedModelConfig.alternateModels?.secondaryApiKeyId,
  )
  const fallbackSecondary = apiKeys.find((key) => key.id !== primaryApiKeyId)?.id ?? ''
  const secondaryApiKeyId = secondaryFromConfig ?? fallbackSecondary

  const alternateModelsEnabled =
    (normalizedModelConfig.alternateModels?.enabled ?? false) &&
    !!primaryApiKeyId &&
    !!secondaryApiKeyId &&
    primaryApiKeyId !== secondaryApiKeyId

  return {
    primaryApiKeyId,
    secondaryApiKeyId,
    alternateModelsEnabled,
  }
}

type UseChatInterfaceSettingsArgs = {
  chatId: string
  apiKeys: ApiKeyOption[]
  preselectedApiKeyId?: string
  initialModelConfig?: ChatModelConfig | null
  isDeveloper: boolean
}

type UseChatInterfaceSettingsReturn = {
  selectedApiKeyId: string
  secondaryApiKeyId: string
  selectedApiKey: ApiKeyOption | null
  alternateModelsEnabled: boolean
  memoryMode: ChatMemoryMode
  agenticTranscriptRecallMode: AgenticTranscriptRecallOverrideMode
  anthropicBatchModeEnabled: boolean
  anthropicBatchModeAvailable: boolean
  deliveryMode: ChatDeliveryMode
  developerMode: boolean
  handleToggleAlternateModels: () => void
  handleSelectPrimaryApiKey: (nextId: string) => void
  handleSelectSecondaryApiKey: (nextId: string) => void
  handleSelectMemoryMode: (nextMode: ChatMemoryMode) => void
  handleSelectAgenticTranscriptRecallMode: (nextMode: AgenticTranscriptRecallOverrideMode) => void
  handleToggleAnthropicBatchMode: () => void
  toggleDeveloperMode: () => void
}

export function useChatInterfaceSettings({
  chatId,
  apiKeys,
  preselectedApiKeyId,
  initialModelConfig,
  isDeveloper,
}: UseChatInterfaceSettingsArgs): UseChatInterfaceSettingsReturn {
  const normalizedModelConfig = useMemo(
    () => normalizeChatModelConfig(initialModelConfig),
    [initialModelConfig],
  )
  const initialResolvedMemoryConfig = useMemo(
    () =>
      resolveChatMemoryConfig(normalizedModelConfig, {
        defaultMode: isDeveloper ? 'prefix_live_blocks' : undefined,
      }),
    [isDeveloper, normalizedModelConfig],
  )
  const initialAgenticTranscriptRecallMode = useMemo(
    () => resolveAgenticTranscriptRecallOverrideMode(normalizedModelConfig),
    [normalizedModelConfig],
  )
  const agenticTranscriptRecallTemplate = useMemo(
    () => normalizedModelConfig.experimental?.agenticTranscriptRecall ?? null,
    [normalizedModelConfig],
  )
  const didPersistOperatorDefaultMemoryRef = useRef(false)
  const initialSettings = useMemo(
    () =>
      resolveInitialChatSettings({
        apiKeys,
        preselectedApiKeyId,
        normalizedModelConfig,
        storedApiKeyId:
          typeof window === 'undefined' ? null : localStorage.getItem('lastUsedApiKey'),
      }),
    [apiKeys, normalizedModelConfig, preselectedApiKeyId],
  )

  const [selectedApiKeyId, setSelectedApiKeyId] = useState(initialSettings.primaryApiKeyId)
  const [secondaryApiKeyId, setSecondaryApiKeyId] = useState(initialSettings.secondaryApiKeyId)
  const [alternateModelsEnabled, setAlternateModelsEnabled] = useState(
    initialSettings.alternateModelsEnabled,
  )
  const [memoryMode, setMemoryMode] = useState<ChatMemoryMode>(initialResolvedMemoryConfig.mode)
  const [agenticTranscriptRecallMode, setAgenticTranscriptRecallMode] =
    useState<AgenticTranscriptRecallOverrideMode>(initialAgenticTranscriptRecallMode)
  const [memorySettings] = useState(() => ({
    sealEveryMessages: initialResolvedMemoryConfig.sealEveryMessages,
    retainTailMessages: initialResolvedMemoryConfig.retainTailMessages,
  }))
  const [anthropicBatchModeEnabled, setAnthropicBatchModeEnabled] = useState(false)
  const [developerMode, setDeveloperMode] = useState(false)

  useEffect(() => {
    if (
      !isDeveloper ||
      normalizedModelConfig.memory ||
      didPersistOperatorDefaultMemoryRef.current
    ) {
      return
    }

    didPersistOperatorDefaultMemoryRef.current = true
    const operatorDefaultConfig = buildOperatorDefaultChatModelConfig(normalizedModelConfig)

    void updateChatModelConfig(chatId, operatorDefaultConfig).then((result) => {
      if (result?.error) {
        toast.error(result.error)
      }
    })
  }, [chatId, isDeveloper, normalizedModelConfig])

  useEffect(() => {
    if (selectedApiKeyId) {
      localStorage.setItem('lastUsedApiKey', selectedApiKeyId)
    }
  }, [selectedApiKeyId])

  const persistModelConfig = useCallback(
    async (
      nextEnabled: boolean,
      nextPrimary: string,
      nextSecondary: string,
      nextMemoryMode: ChatMemoryMode,
      nextAgenticTranscriptRecallMode: AgenticTranscriptRecallOverrideMode,
    ) => {
      const config = {
        alternateModels: {
          enabled: nextEnabled,
          primaryApiKeyId: nextPrimary || null,
          secondaryApiKeyId: nextSecondary || null,
        },
        memory:
          nextMemoryMode === 'prefix_live_blocks'
            ? {
                mode: nextMemoryMode,
                sealEveryMessages: memorySettings.sealEveryMessages,
                retainTailMessages: memorySettings.retainTailMessages,
              }
            : null,
        experimental:
          nextAgenticTranscriptRecallMode === 'inherit'
            ? {}
            : {
                agenticTranscriptRecall: {
                  ...(agenticTranscriptRecallTemplate ?? {}),
                  enabled: nextAgenticTranscriptRecallMode === 'enabled',
                },
              },
      }

      const result = await updateChatModelConfig(chatId, config)
      if (result?.error) {
        toast.error(result.error)
      }
    },
    [
      agenticTranscriptRecallTemplate,
      chatId,
      memorySettings.retainTailMessages,
      memorySettings.sealEveryMessages,
    ],
  )

  const selectedApiKey = useMemo(
    () => apiKeys.find((key) => key.id === selectedApiKeyId) ?? null,
    [apiKeys, selectedApiKeyId],
  )
  const anthropicBatchChatEnabled = isAnthropicBatchChatEnabled()
  const anthropicBatchModeSupported = isAnthropicBatchChatSupported({
    provider: selectedApiKey?.provider,
    modelName: selectedApiKey?.model_preference,
  })
  const anthropicBatchModeAvailable =
    anthropicBatchChatEnabled && !alternateModelsEnabled && anthropicBatchModeSupported
  const deliveryMode =
    anthropicBatchModeEnabled && anthropicBatchModeAvailable
      ? CHAT_DELIVERY_MODE_ANTHROPIC_BATCH
      : CHAT_DELIVERY_MODE_STREAMING

  useEffect(() => {
    if (!anthropicBatchModeAvailable && anthropicBatchModeEnabled) {
      setAnthropicBatchModeEnabled(false)
    }
  }, [anthropicBatchModeAvailable, anthropicBatchModeEnabled])

  useEffect(() => {
    const saved = localStorage.getItem('developerMode')
    if (saved === 'true') {
      setDeveloperMode(true)
    }
  }, [])

  const handleToggleAlternateModels = useCallback(() => {
    const nextEnabled = !alternateModelsEnabled
    if (nextEnabled) {
      if (!selectedApiKeyId || !secondaryApiKeyId) {
        toast.error('교대 모드를 사용하려면 두 개의 API 키를 선택하세요.')
        return
      }
      if (selectedApiKeyId === secondaryApiKeyId) {
        toast.error('교대 모드는 서로 다른 API 키가 필요합니다.')
        return
      }
    }

    setAlternateModelsEnabled(nextEnabled)
    void persistModelConfig(
      nextEnabled,
      selectedApiKeyId,
      secondaryApiKeyId,
      memoryMode,
      agenticTranscriptRecallMode,
    )
  }, [
    agenticTranscriptRecallMode,
    alternateModelsEnabled,
    memoryMode,
    persistModelConfig,
    secondaryApiKeyId,
    selectedApiKeyId,
  ])

  const handleSelectPrimaryApiKey = useCallback(
    (nextId: string) => {
      setSelectedApiKeyId(nextId)
      if (alternateModelsEnabled && nextId === secondaryApiKeyId) {
        toast.error('교대 모드는 서로 다른 API 키가 필요합니다.')
      }
      void persistModelConfig(
        alternateModelsEnabled,
        nextId,
        secondaryApiKeyId,
        memoryMode,
        agenticTranscriptRecallMode,
      )
    },
    [
      agenticTranscriptRecallMode,
      alternateModelsEnabled,
      memoryMode,
      persistModelConfig,
      secondaryApiKeyId,
    ],
  )

  const handleSelectSecondaryApiKey = useCallback(
    (nextId: string) => {
      setSecondaryApiKeyId(nextId)
      if (alternateModelsEnabled && nextId === selectedApiKeyId) {
        toast.error('교대 모드는 서로 다른 API 키가 필요합니다.')
      }
      void persistModelConfig(
        alternateModelsEnabled,
        selectedApiKeyId,
        nextId,
        memoryMode,
        agenticTranscriptRecallMode,
      )
    },
    [
      agenticTranscriptRecallMode,
      alternateModelsEnabled,
      memoryMode,
      persistModelConfig,
      selectedApiKeyId,
    ],
  )

  const handleSelectMemoryMode = useCallback(
    (nextMode: ChatMemoryMode) => {
      setMemoryMode(nextMode)
      void persistModelConfig(
        alternateModelsEnabled,
        selectedApiKeyId,
        secondaryApiKeyId,
        nextMode,
        agenticTranscriptRecallMode,
      )
    },
    [
      agenticTranscriptRecallMode,
      alternateModelsEnabled,
      persistModelConfig,
      secondaryApiKeyId,
      selectedApiKeyId,
    ],
  )

  const handleSelectAgenticTranscriptRecallMode = useCallback(
    (nextMode: AgenticTranscriptRecallOverrideMode) => {
      setAgenticTranscriptRecallMode(nextMode)
      void persistModelConfig(
        alternateModelsEnabled,
        selectedApiKeyId,
        secondaryApiKeyId,
        memoryMode,
        nextMode,
      )
    },
    [alternateModelsEnabled, memoryMode, persistModelConfig, secondaryApiKeyId, selectedApiKeyId],
  )

  const handleToggleAnthropicBatchMode = useCallback(() => {
    if (!anthropicBatchModeAvailable && !anthropicBatchModeEnabled) {
      if (!anthropicBatchChatEnabled) {
        toast.error('Claude Batch 모드는 이 배포에서 기본 비활성화되어 있습니다.')
        return
      }

      toast.error('Claude Batch 모드는 Anthropic Opus 4.5/4.6 키에서만 사용할 수 있습니다.')
      return
    }
    setAnthropicBatchModeEnabled((current) => !current)
  }, [anthropicBatchChatEnabled, anthropicBatchModeAvailable, anthropicBatchModeEnabled])

  const toggleDeveloperMode = useCallback(() => {
    const nextValue = !developerMode
    setDeveloperMode(nextValue)
    localStorage.setItem('developerMode', String(nextValue))
  }, [developerMode])

  return {
    selectedApiKeyId,
    secondaryApiKeyId,
    selectedApiKey,
    alternateModelsEnabled,
    memoryMode,
    agenticTranscriptRecallMode,
    anthropicBatchModeEnabled,
    anthropicBatchModeAvailable,
    deliveryMode,
    developerMode,
    handleToggleAlternateModels,
    handleSelectPrimaryApiKey,
    handleSelectSecondaryApiKey,
    handleSelectMemoryMode,
    handleSelectAgenticTranscriptRecallMode,
    handleToggleAnthropicBatchMode,
    toggleDeveloperMode,
  }
}
