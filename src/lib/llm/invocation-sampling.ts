type ResolveInvocationSamplingOptionsInput = {
  provider: string
  modelName: string
  reasoningEffort?: string | null
}

export function resolveInvocationSamplingOptions({
  provider,
  modelName: _modelName,
  reasoningEffort: _reasoningEffort,
}: ResolveInvocationSamplingOptionsInput): Record<string, never> {
  if (provider === 'openrouter') {
    return {}
  }

  if (provider === 'openai') {
    return {}
  }

  return {}
}
