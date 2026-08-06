import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ChatModelConfig, ChatMemoryMode } from '@/lib/chat/model-config'
import {
  buildOperatorDefaultChatModelConfig,
  normalizeChatModelConfig,
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

type ChatInterfaceSettingsSnapshot = {
  selectedModel: LlmModelSelection
  secondaryModel: LlmModelSelection
  alternateModelsEnabled: boolean
  memoryMode: ChatMemoryMode
}

function getModelConfigSaveErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : '모델 설정을 저장하지 못했습니다.'
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
  const [memoryRetainTailMessages] = useState(initialResolvedMemoryConfig.retainTailMessages)
  const [anthropicBatchModeEnabled, setAnthropicBatchModeEnabled] = useState(false)
  const [developerMode, setDeveloperMode] = useState(false)
  const confirmedSettingsRef = useRef<ChatInterfaceSettingsSnapshot>({
    selectedModel,
    secondaryModel,
    alternateModelsEnabled,
    memoryMode,
  })
  const modelConfigSaveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const latestModelConfigSaveRevisionRef = useRef(0)

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

    void updateChatModelConfig(chatId, { memory: operatorDefaultConfig.memory })
      .then((result) => {
        if (result?.error) {
          toast.error(result.error)
        }
      })
      .catch((error: unknown) => {
        toast.error(getModelConfigSaveErrorMessage(error))
      })
  }, [chatId, isDeveloper, normalizedModelConfig])

  useEffect(() => {
    localStorage.removeItem('lastUsedApiKey')
    localStorage.removeItem('lastUsedModel')
  }, [])

  const persistModelConfig = useCallback(
    (snapshot: ChatInterfaceSettingsSnapshot) => {
      const revision = latestModelConfigSaveRevisionRef.current + 1
      latestModelConfigSaveRevisionRef.current = revision

      const save = async () => {
        try {
          const result = await updateChatModelConfig(chatId, {
            alternateModels: {
              enabled: snapshot.alternateModelsEnabled,
              primaryApiKeyId: snapshot.selectedModel.apiKeyId || null,
              primaryModelName: snapshot.selectedModel.modelName || null,
              secondaryApiKeyId: snapshot.secondaryModel.apiKeyId || null,
              secondaryModelName: snapshot.secondaryModel.modelName || null,
            },
            memory:
              snapshot.memoryMode === 'prefix_live_blocks'
                ? {
                    mode: snapshot.memoryMode,
                    retainTailMessages: memoryRetainTailMessages,
                  }
                : null,
          })

          if (result?.error) {
            throw new Error(result.error)
          }

          confirmedSettingsRef.current = snapshot
        } catch (error) {
          if (latestModelConfigSaveRevisionRef.current !== revision) {
            return
          }

          const confirmed = confirmedSettingsRef.current
          setSelectedModel(confirmed.selectedModel)
          setSecondaryModel(confirmed.secondaryModel)
          setAlternateModelsEnabled(confirmed.alternateModelsEnabled)
          setMemoryMode(confirmed.memoryMode)
          toast.error(getModelConfigSaveErrorMessage(error))
        }
      }

      modelConfigSaveQueueRef.current = modelConfigSaveQueueRef.current.then(save, save)
    },
    [chatId, memoryRetainTailMessages],
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
    persistModelConfig({
      alternateModelsEnabled: nextEnabled,
      selectedModel,
      secondaryModel,
      memoryMode,
    })
  }, [alternateModelsEnabled, memoryMode, persistModelConfig, secondaryModel, selectedModel])

  const handleSelectPrimaryModel = useCallback(
    (nextModel: LlmModelSelection) => {
      setSelectedModel(nextModel)
      if (alternateModelsEnabled && isSameLlmModelSelection(nextModel, secondaryModel)) {
        toast.error('교대 모드는 서로 다른 모델 선택이 필요합니다.')
      }
      persistModelConfig({
        alternateModelsEnabled,
        selectedModel: nextModel,
        secondaryModel,
        memoryMode,
      })
    },
    [alternateModelsEnabled, memoryMode, persistModelConfig, secondaryModel],
  )

  const handleSelectSecondaryModel = useCallback(
    (nextModel: LlmModelSelection) => {
      setSecondaryModel(nextModel)
      if (alternateModelsEnabled && isSameLlmModelSelection(nextModel, selectedModel)) {
        toast.error('교대 모드는 서로 다른 모델 선택이 필요합니다.')
      }
      persistModelConfig({
        alternateModelsEnabled,
        selectedModel,
        secondaryModel: nextModel,
        memoryMode,
      })
    },
    [alternateModelsEnabled, memoryMode, persistModelConfig, selectedModel],
  )

  const handleSelectMemoryMode = useCallback(
    (nextMode: ChatMemoryMode) => {
      setMemoryMode(nextMode)
      persistModelConfig({
        alternateModelsEnabled,
        selectedModel,
        secondaryModel,
        memoryMode: nextMode,
      })
    },
    [alternateModelsEnabled, persistModelConfig, secondaryModel, selectedModel],
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
