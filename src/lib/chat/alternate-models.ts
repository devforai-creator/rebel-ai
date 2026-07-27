import type { AlternateModelsConfig } from './model-config'
import { isSameLlmModelSelection, type LlmModelSelection } from '@/lib/llm/model-selection'

type AlternateResolveInput = {
  alternateModels?: AlternateModelsConfig | null
  selectedModel: LlmModelSelection
  messages: Array<{ role: string; debug_info?: unknown }>
}

type DebugInfoModelConfig = {
  apiKeyId?: string
  modelName?: string
}

type DebugInfo = {
  modelConfig?: DebugInfoModelConfig
}

function readModelSelection(debugInfo: unknown): LlmModelSelection | null {
  if (!debugInfo || typeof debugInfo !== 'object') return null
  const modelConfig = (debugInfo as DebugInfo).modelConfig
  if (!modelConfig || typeof modelConfig !== 'object') return null
  if (
    typeof modelConfig.apiKeyId !== 'string' ||
    !modelConfig.apiKeyId ||
    typeof modelConfig.modelName !== 'string' ||
    !modelConfig.modelName
  ) {
    return null
  }

  return {
    apiKeyId: modelConfig.apiKeyId,
    modelName: modelConfig.modelName,
  }
}

export function resolveAlternateModelSelection({
  alternateModels,
  selectedModel,
  messages,
}: AlternateResolveInput): LlmModelSelection {
  if (!alternateModels?.enabled) {
    return selectedModel
  }

  const primaryModel =
    alternateModels.primaryApiKeyId && alternateModels.primaryModelName
      ? {
          apiKeyId: alternateModels.primaryApiKeyId,
          modelName: alternateModels.primaryModelName,
        }
      : selectedModel
  const secondaryModel =
    alternateModels.secondaryApiKeyId && alternateModels.secondaryModelName
      ? {
          apiKeyId: alternateModels.secondaryApiKeyId,
          modelName: alternateModels.secondaryModelName,
        }
      : null

  if (!secondaryModel || isSameLlmModelSelection(primaryModel, secondaryModel)) {
    return selectedModel
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const previousModel = readModelSelection(message.debug_info)
    if (!previousModel) continue
    return isSameLlmModelSelection(previousModel, primaryModel) ? secondaryModel : primaryModel
  }

  return primaryModel
}
