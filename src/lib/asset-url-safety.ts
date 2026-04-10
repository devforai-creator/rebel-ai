export function isUnsafeImportedAssetUrl(value: string | null | undefined): boolean {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = value.trim()
  if (!normalized) {
    return false
  }

  return /^(?:https?:|data:|javascript:)/i.test(normalized)
}
