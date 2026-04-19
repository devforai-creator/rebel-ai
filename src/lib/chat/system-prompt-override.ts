export function normalizeSystemPromptValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeSystemPromptOverride(
  value: string | null | undefined,
  defaultPrompt: string,
): string | null {
  const normalizedValue = normalizeSystemPromptValue(value)
  const normalizedDefaultPrompt = normalizeSystemPromptValue(defaultPrompt)

  if (normalizedValue === null) {
    return null
  }

  if (normalizedDefaultPrompt !== null && normalizedValue === normalizedDefaultPrompt) {
    return null
  }

  return normalizedValue
}

export function hasCustomSystemPromptOverride(
  value: string | null | undefined,
  defaultPrompt: string,
): boolean {
  return normalizeSystemPromptOverride(value, defaultPrompt) !== null
}

export function parseSystemPromptOverrideInput(
  rawPrompt: unknown,
  defaultPrompt: string,
): { success: true; systemPrompt: string | null } | { success: false } {
  if (typeof rawPrompt !== 'string' && rawPrompt !== null) {
    return { success: false }
  }

  return {
    success: true,
    systemPrompt: normalizeSystemPromptOverride(rawPrompt, defaultPrompt),
  }
}
