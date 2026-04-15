import { normalizeAssetKey } from './asset-uri'
import { SUPPORT_TIER_FEATURES } from './support-tier'

const LEGACY_IMAGE_EXTENSIONS = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.avif']
const LOOSE_IMAGE_EXTENSION_REGEX = /\.(png|webp|jpg|jpeg|gif|avif|mp4|webm)$/i

export const LEGACY_ASSET_URL_COMPATIBILITY_SUPPORT =
  SUPPORT_TIER_FEATURES.LEGACY_ASSET_URL_COMPATIBILITY

export function registerLegacyCompatibleAssetUrlKeys(
  urlMap: Record<string, string>,
  key: string | null | undefined,
  publicUrl: string,
): void {
  if (!key) return

  // RisuAI-style fuzzy lookup where underscores and wrapper chars drift.
  const fuzzyNormalized = normalizeAssetKeyFuzzy(key)
  if (fuzzyNormalized && fuzzyNormalized !== key) {
    urlMap[fuzzyNormalized] = publicUrl
  }

  const baseName = key.split('/').pop()
  if (!baseName || baseName === key) {
    return
  }

  const fuzzyBase = normalizeAssetKeyFuzzy(baseName)
  if (fuzzyBase && fuzzyBase !== baseName) {
    urlMap[fuzzyBase] = publicUrl
  }
}

export function resolveLegacyCompatibleAssetUrl(
  source: string,
  assetUrlMap: Record<string, string>,
): string | undefined {
  if (!assetUrlMap || !source) return undefined

  // Try fuzzy lookup (underscores removed) for legacy imported packages.
  const fuzzyNormalized = normalizeAssetKeyFuzzy(source)
  if (fuzzyNormalized) {
    const fuzzyMatch = assetUrlMap[fuzzyNormalized]
    if (fuzzyMatch) {
      return fuzzyMatch
    }
  }

  const base = source.split('/').pop()
  if (base && base !== source) {
    const fuzzyBase = normalizeAssetKeyFuzzy(base)
    if (fuzzyBase) {
      const fuzzyBaseMatch = assetUrlMap[fuzzyBase]
      if (fuzzyBaseMatch) {
        return fuzzyBaseMatch
      }
    }
  }

  // Legacy imports sometimes reference extension-less keys even when aliases were not stored.
  for (const ext of LEGACY_IMAGE_EXTENSIONS) {
    const withExt = source + ext
    const match = assetUrlMap[withExt]
    if (match) {
      return match
    }

    const normalizedWithExt = normalizeAssetKey(withExt)
    if (normalizedWithExt) {
      const normalizedMatch = assetUrlMap[normalizedWithExt]
      if (normalizedMatch) {
        return normalizedMatch
      }
    }

    const looseWithExt = normalizeAssetKeyLoose(withExt)
    if (looseWithExt) {
      const looseMatch = assetUrlMap[looseWithExt]
      if (looseMatch) {
        return looseMatch
      }
    }

    const fuzzyWithExt = normalizeAssetKeyFuzzy(withExt)
    if (fuzzyWithExt) {
      const fuzzyMatch = assetUrlMap[fuzzyWithExt]
      if (fuzzyMatch) {
        return fuzzyMatch
      }
    }

    // Buggy imports may have stored a double extension.
    const withDoubleExt = source + ext + ext
    const doubleMatch = assetUrlMap[withDoubleExt]
    if (doubleMatch) {
      return doubleMatch
    }

    const normalizedDoubleExt = normalizeAssetKey(withDoubleExt)
    if (normalizedDoubleExt) {
      const normalizedDoubleMatch = assetUrlMap[normalizedDoubleExt]
      if (normalizedDoubleMatch) {
        return normalizedDoubleMatch
      }
    }
  }

  return undefined
}

function normalizeAssetKeyLoose(value?: string | null): string | null {
  const normalized = normalizeAssetKey(value)
  if (!normalized) {
    return null
  }

  const extMatch = normalized.match(LOOSE_IMAGE_EXTENSION_REGEX)
  const ext = extMatch?.[0] ?? ''
  const base = ext ? normalized.slice(0, -ext.length) : normalized
  const looseBase = base.replace(/[.]+/g, '_')

  return `${looseBase}${ext}`
}

function normalizeAssetKeyFuzzy(value?: string | null): string | null {
  const normalized = normalizeAssetKey(value)
  if (!normalized) {
    return null
  }

  const extMatch = normalized.match(LOOSE_IMAGE_EXTENSION_REGEX)
  const ext = extMatch?.[0] ?? ''
  const base = ext ? normalized.slice(0, -ext.length) : normalized
  const fuzzyBase = base.replace(/[_()[\]{}]/g, '')

  return `${fuzzyBase}${ext}`
}
