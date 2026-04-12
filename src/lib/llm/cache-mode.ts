export type ProviderCacheMode = 'auto' | 'off'

const warnedKeys = new Set<string>()

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) {
    return
  }

  warnedKeys.add(key)
  console.warn(message)
}

export function resolveProviderCacheMode({
  modeEnvName,
  legacyEnvNames = [],
}: {
  modeEnvName: string
  legacyEnvNames?: string[]
}): ProviderCacheMode {
  for (const legacyEnvName of legacyEnvNames) {
    if (process.env[legacyEnvName] !== undefined) {
      warnOnce(
        `legacy:${modeEnvName}:${legacyEnvName}`,
        `[Provider Cache] Ignoring legacy env var ${legacyEnvName}. Use ${modeEnvName}=auto|off instead.`,
      )
    }
  }

  const rawMode = process.env[modeEnvName]?.trim()
  if (!rawMode) {
    return 'off'
  }

  const normalizedMode = rawMode.toLowerCase()
  if (normalizedMode === 'auto' || normalizedMode === 'off') {
    return normalizedMode
  }

  warnOnce(
    `invalid:${modeEnvName}`,
    `[Provider Cache] Invalid ${modeEnvName} value "${rawMode}". Falling back to off.`,
  )
  return 'off'
}
