import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  AgenticTranscriptRecallOverrideMode,
  ChatModelConfig,
  ChatMemoryMode,
} from '@/lib/chat/model-config'
import {
  buildAgenticTranscriptRecallOverrideModelConfigPatch,
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
import {
  buildLlmModelOptions,
  isSameLlmModelSelection,
  resolveLlmModelSelection,
  type LlmModelSelection,
} from '@/lib/llm/model-selection'
import { updateChatModelConfig } from '../actions'
import type { ApiKeyOption } from '../utils'

type ResolveInitialChatSettingsArgs = {
  apiKeys: ApiKeyOption[]
  preselectedApiKeyId?: string
  preselectedModelName?: string
  normalizedModelConfig: ReturnType<typeof normalizeChatModelConfig>
}

export type InitialChatSettings = {
  primaryApiKeyId: string
  primaryModelName: string
  secondaryApiKeyId: string
  secondaryModelName: string
  alternateModelsEnabled: boolean
}

export function resolveInitialChatSettings({
  apiKeys,
  preselectedApiKeyId,
  preselectedModelName,
  normalizedModelConfig,
}: ResolveInitialChatSettingsArgs): InitialChatSettings {
  const primarySelection =
    resolveLlmModelSelection({
      credentials: apiKeys,
      apiKeyId: normalizedModelConfig.alternateModels?.primaryApiKeyId,
      modelName: normalizedModelConfig.alternateModels?.primaryModelName,
    }) ??
    resolveLlmModelSelection({
      credentials: apiKeys,
      apiKeyId: preselectedApiKeyId,
      modelName: preselectedModelName,
    }) ??
    resolveLlmModelSelection({
      credentials: apiKeys,
      apiKeyId: apiKeys[0]?.id,
    })

  const modelOptions = buildLlmModelOptions(apiKeys)
  const secondaryFromConfig = resolveLlmModelSelection({
    credentials: apiKeys,
    apiKeyId: normalizedModelConfig.alternateModels?.secondaryApiKeyId,
    modelName: normalizedModelConfig.alternateModels?.secondaryModelName,
  })
  const fallbackSecondary =
    [
      ...apiKeys.map((credential) =>
        resolveLlmModelSelection({
          credentials: apiKeys,
          apiKeyId: credential.id,
        }),
      ),
      ...modelOptions.map((option) => ({
        apiKeyId: option.credential.id,
        modelName: option.modelName,
      })),
    ]
      .filter((selection): selection is LlmModelSelection => selection !== null)
      .find((selection) => !isSameLlmModelSelection(selection, primarySelection)) ?? null
  const secondarySelection = secondaryFromConfig ?? fallbackSecondary

  const alternateModelsEnabled =
    (normalizedModelConfig.alternateModels?.enabled ?? false) &&
    !!primarySelection &&
    !!secondarySelection &&
    !isSameLlmModelSelection(primarySelection, secondarySelection)

  return {
    primaryApiKeyId: primarySelection?.apiKeyId ?? '',
    primaryModelName: primarySelection?.modelName ?? '',
    secondaryApiKeyId: secondarySelection?.apiKeyId ?? '',
    secondaryModelName: secondarySelection?.modelName ?? '',
    alternateModelsEnabled,
  }
}

type UseChatInterfaceSettingsArgs = {
  chatId: string
  apiKeys: ApiKeyOption[]
  preselectedApiKeyId?: string
  preselectedModelName?: string
  initialModelConfig?: ChatModelConfig | null
  isDeveloper: boolean
}

type UseChatInterfaceSettingsReturn = {
  selectedApiKeyId: string
  selectedModelName: string
  secondaryApiKeyId: string
  secondaryModelName: string
  selectedApiKey: ApiKeyOption | null
  alternateModelsEnabled: boolean
  memoryMode: ChatMemoryMode
  anthropicBatchModeEnabled: boolean
  anthropicBatchModeAvailable: boolean
  deliveryMode: ChatDeliveryMode
  developerMode: boolean
  handleToggleAlternateModels: () => void
  handleSelectPrimaryModel: (selection: LlmModelSelection) => void
  handleSelectSecondaryModel: (selection: LlmModelSelection) => void
  handleSelectMemoryMode: (nextMode: ChatMemoryMode) => void
  handleToggleAnthropicBatchMode: () => void
  toggleDeveloperMode: () => void
}

export function useChatInterfaceSettings({
  chatId,
  apiKeys,
  preselectedApiKeyId,
  preselectedModelName,
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
  const didPersistOperatorDefaultMemoryRef = useRef(false)
  const initialSettings = useMemo(
    () =>
      resolveInitialChatSettings({
        apiKeys,
        preselectedApiKeyId,
        preselectedModelName,
        normalizedModelConfig,
      }),
    [apiKeys, normalizedModelConfig, preselectedApiKeyId, preselectedModelName],
  )

  const [selectedModel, setSelectedModel] = useState<LlmModelSelection>({
    apiKeyId: initialSettings.primaryApiKeyId,
    modelName: initialSettings.primaryModelName,
  })
  const [secondaryModel, setSecondaryModel] = useState<LlmModelSelection>({
    apiKeyId: initialSettings.secondaryApiKeyId,
    modelName: initialSettings.secondaryModelName,
  })
  const [alternateModelsEnabled, setAlternateModelsEnabled] = useState(
    initialSettings.alternateModelsEnabled,
  )
  const [memoryMode, setMemoryMode] = useState<ChatMemoryMode>(initialResolvedMemoryConfig.mode)
  const agenticTranscriptRecallMode = initialAgenticTranscriptRecallMode
  const [memoryRetainTailMessages] = useState(initialResolvedMemoryConfig.retainTailMessages)
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
    localStorage.removeItem('lastUsedApiKey')
    localStorage.removeItem('lastUsedModel')
  }, [])

  const persistModelConfig = useCallback(
    async (
      nextEnabled: boolean,
      nextPrimary: LlmModelSelection,
      nextSecondary: LlmModelSelection,
      nextMemoryMode: ChatMemoryMode,
      nextAgenticTranscriptRecallMode: AgenticTranscriptRecallOverrideMode,
    ) => {
      const config = {
        alternateModels: {
          enabled: nextEnabled,
          primaryApiKeyId: nextPrimary.apiKeyId || null,
          primaryModelName: nextPrimary.modelName || null,
          secondaryApiKeyId: nextSecondary.apiKeyId || null,
          secondaryModelName: nextSecondary.modelName || null,
        },
        memory:
          nextMemoryMode === 'prefix_live_blocks'
            ? {
                mode: nextMemoryMode,
                retainTailMessages: memoryRetainTailMessages,
              }
            : null,
        ...buildAgenticTranscriptRecallOverrideModelConfigPatch(
          normalizedModelConfig,
          nextAgenticTranscriptRecallMode,
        ),
      }

      const result = await updateChatModelConfig(chatId, config)
      if (result?.error) {
        toast.error(result.error)
      }
    },
    [chatId, memoryRetainTailMessages, normalizedModelConfig],
  )

  const selectedApiKey = useMemo(
    () => apiKeys.find((key) => key.id === selectedModel.apiKeyId) ?? null,
    [apiKeys, selectedModel.apiKeyId],
  )
  const anthropicBatchChatEnabled = isAnthropicBatchChatEnabled()
  const anthropicBatchModeSupported = isAnthropicBatchChatSupported({
    provider: selectedApiKey?.provider,
    modelName: selectedModel.modelName,
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
      if (
        !selectedModel.apiKeyId ||
        !selectedModel.modelName ||
        !secondaryModel.apiKeyId ||
        !secondaryModel.modelName
      ) {
        toast.error('교대 모드를 사용하려면 두 개의 모델을 선택하세요.')
        return
      }
      if (isSameLlmModelSelection(selectedModel, secondaryModel)) {
        toast.error('교대 모드는 서로 다른 모델 선택이 필요합니다.')
        return
      }
    }

    setAlternateModelsEnabled(nextEnabled)
    void persistModelConfig(
      nextEnabled,
      selectedModel,
      secondaryModel,
      memoryMode,
      agenticTranscriptRecallMode,
    )
  }, [
    agenticTranscriptRecallMode,
    alternateModelsEnabled,
    memoryMode,
    persistModelConfig,
    secondaryModel,
    selectedModel,
  ])

  const handleSelectPrimaryModel = useCallback(
    (nextModel: LlmModelSelection) => {
      setSelectedModel(nextModel)
      if (alternateModelsEnabled && isSameLlmModelSelection(nextModel, secondaryModel)) {
        toast.error('교대 모드는 서로 다른 모델 선택이 필요합니다.')
      }
      void persistModelConfig(
        alternateModelsEnabled,
        nextModel,
        secondaryModel,
        memoryMode,
        agenticTranscriptRecallMode,
      )
    },
    [
      agenticTranscriptRecallMode,
      alternateModelsEnabled,
      memoryMode,
      persistModelConfig,
      secondaryModel,
    ],
  )

  const handleSelectSecondaryModel = useCallback(
    (nextModel: LlmModelSelection) => {
      setSecondaryModel(nextModel)
      if (alternateModelsEnabled && isSameLlmModelSelection(nextModel, selectedModel)) {
        toast.error('교대 모드는 서로 다른 모델 선택이 필요합니다.')
      }
      void persistModelConfig(
        alternateModelsEnabled,
        selectedModel,
        nextModel,
        memoryMode,
        agenticTranscriptRecallMode,
      )
    },
    [
      agenticTranscriptRecallMode,
      alternateModelsEnabled,
      memoryMode,
      persistModelConfig,
      selectedModel,
    ],
  )

  const handleSelectMemoryMode = useCallback(
    (nextMode: ChatMemoryMode) => {
      setMemoryMode(nextMode)
      void persistModelConfig(
        alternateModelsEnabled,
        selectedModel,
        secondaryModel,
        nextMode,
        agenticTranscriptRecallMode,
      )
    },
    [
      agenticTranscriptRecallMode,
      alternateModelsEnabled,
      persistModelConfig,
      secondaryModel,
      selectedModel,
    ],
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
    selectedApiKeyId: selectedModel.apiKeyId,
    selectedModelName: selectedModel.modelName,
    secondaryApiKeyId: secondaryModel.apiKeyId,
    secondaryModelName: secondaryModel.modelName,
    selectedApiKey,
    alternateModelsEnabled,
    memoryMode,
    anthropicBatchModeEnabled,
    anthropicBatchModeAvailable,
    deliveryMode,
    developerMode,
    handleToggleAlternateModels,
    handleSelectPrimaryModel,
    handleSelectSecondaryModel,
    handleSelectMemoryMode,
    handleToggleAnthropicBatchMode,
    toggleDeveloperMode,
  }
}
