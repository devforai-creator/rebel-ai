import type { AlternateModelsConfig } from './model-config'

type AlternateResolveInput = {
  alternateModels?: AlternateModelsConfig | null
  selectedApiKeyId: string
  messages: Array<{ role: string; debug_info?: unknown }>
}

type DebugInfoModelConfig = {
  apiKeyId?: string
}

type DebugInfo = {
  modelConfig?: DebugInfoModelConfig
}

function readApiKeyId(debugInfo: unknown): string | null {
  if (!debugInfo || typeof debugInfo !== 'object') return null
  const modelConfig = (debugInfo as DebugInfo).modelConfig
  if (!modelConfig || typeof modelConfig !== 'object') return null
  return typeof modelConfig.apiKeyId === 'string' && modelConfig.apiKeyId
    ? modelConfig.apiKeyId
    : null
}

export function resolveAlternateApiKeyId({
  alternateModels,
  selectedApiKeyId,
  messages,
}: AlternateResolveInput): string {
  if (!alternateModels?.enabled) {
    return selectedApiKeyId
  }

  const primaryApiKeyId = alternateModels.primaryApiKeyId || selectedApiKeyId
  const secondaryApiKeyId = alternateModels.secondaryApiKeyId

  if (!primaryApiKeyId || !secondaryApiKeyId || primaryApiKeyId === secondaryApiKeyId) {
    return selectedApiKeyId
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const apiKeyId = readApiKeyId(message.debug_info)
    if (!apiKeyId) continue
    return apiKeyId === primaryApiKeyId ? secondaryApiKeyId : primaryApiKeyId
  }

  return primaryApiKeyId
}
