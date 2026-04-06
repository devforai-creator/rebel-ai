export type AlternateModelsConfig = {
  enabled: boolean
  primaryApiKeyId: string | null
  secondaryApiKeyId: string | null
}

export type ChatModelConfig = {
  alternateModels?: AlternateModelsConfig | null
}

export function normalizeChatModelConfig(input: unknown): ChatModelConfig {
  if (!input || typeof input !== 'object') {
    return {}
  }

  const candidate = input as { alternateModels?: unknown }
  if (!candidate.alternateModels || typeof candidate.alternateModels !== 'object') {
    return {}
  }

  const raw = candidate.alternateModels as Record<string, unknown>
  const enabled = raw.enabled === true
  const primaryApiKeyId =
    typeof raw.primaryApiKeyId === 'string' && raw.primaryApiKeyId ? raw.primaryApiKeyId : null
  const secondaryApiKeyId =
    typeof raw.secondaryApiKeyId === 'string' && raw.secondaryApiKeyId
      ? raw.secondaryApiKeyId
      : null

  return {
    alternateModels: {
      enabled,
      primaryApiKeyId,
      secondaryApiKeyId,
    },
  }
}
