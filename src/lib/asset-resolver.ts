/**
 * Asset Resolution Utility
 *
 * Single source of truth for asset URL resolution.
 *
 * Strategies (in order):
 * 1. Exact match (aliases, file_name, display_name, canonical_name)
 * 2. Normalized match (case-insensitive, space/underscore agnostic)
 * 3. Prefix match (for emotion variants: "sad" → "sad_1", "sad_2")
 *
 * Compatibility implementation based on RebelAI runtime behavior and legacy
 * package conventions.
 */

import { normalizeAssetKey } from './asset-uri'
import { extractAssetTokens, unwrapAssetToken } from './asset-token'
import {
  registerLegacyCompatibleAssetUrlKeys,
  resolveLegacyCompatibleAssetUrl,
} from './asset-url-map-legacy-compat'

// Re-export for convenience
export { normalizeAssetKey } from './asset-uri'

export interface AssetMetadata {
  aliases?: string[]
  [key: string]: unknown
}

export interface CharacterAsset {
  id: string
  file_name: string
  storage_path: string
  display_name?: string | null
  canonical_name?: string | null
  display_order?: number | null
  metadata: AssetMetadata | null
}

export interface AssetResolutionContext {
  /** Character assets from database */
  assets: CharacterAsset[]
  /** @deprecated Use character_assets.metadata.aliases instead */
  emotionImages?: Record<string, string> | null
  /** Base URL for constructing public URLs */
  storageBaseUrl: string
  /** Bucket name (default: 'character-assets') */
  bucketName?: string
}

export interface AssetResolutionResult {
  /** Public URL of the matched asset */
  url: string
  /** Matched asset record */
  asset: CharacterAsset
  /** Match strategy used */
  strategy: 'exact' | 'normalized' | 'prefix'
}

/**
 * Resolve asset tag to public URL
 *
 * @param tag - Asset tag (e.g., "clothed_smile", "Pequod", "{{img::Pequod}}")
 * @param context - Resolution context with assets and configuration
 * @returns Asset URL if found, null otherwise
 *
 * @example
 * ```typescript
 * const result = resolveAssetTag("clothed_smile", {
 *   assets: characterAssets,
 *   storageBaseUrl: "https://...storage.supabase.co"
 * })
 * if (result) {
 *   console.log(result.url) // https://.../character-assets/user/char/file.webp
 * }
 * ```
 */
export function resolveAssetTag(
  tag: string,
  context: AssetResolutionContext,
): AssetResolutionResult | null {
  if (!tag || !context.assets || context.assets.length === 0) {
    return null
  }

  const orderedAssets = sortAssetsForResolution(context.assets)

  // Clean up tag (remove {{img::...}} or [ 🖼 | ... ] wrappers)
  const cleanTag = cleanAssetTag(tag)
  if (!cleanTag) {
    return null
  }

  // Strategy 1: Exact match in aliases
  const exactMatch = findExactMatch(cleanTag, orderedAssets)
  if (exactMatch) {
    return {
      url: buildPublicUrl(exactMatch, context),
      asset: exactMatch,
      strategy: 'exact',
    }
  }

  // Strategy 2: Normalized match (case-insensitive, space/underscore agnostic)
  const normalizedMatch = findNormalizedMatch(cleanTag, orderedAssets)
  if (normalizedMatch) {
    return {
      url: buildPublicUrl(normalizedMatch, context),
      asset: normalizedMatch,
      strategy: 'normalized',
    }
  }

  // Strategy 3: Prefix match (for emotion variants)
  const prefixMatch = findPrefixMatch(cleanTag, orderedAssets)
  if (prefixMatch) {
    return {
      url: buildPublicUrl(prefixMatch, context),
      asset: prefixMatch,
      strategy: 'prefix',
    }
  }

  return null
}

/**
 * Clean asset tag by removing wrapper syntax
 *
 * Supports:
 * - ![alt](asset:name) → name
 * - {{image::name}} → name
 * - {{img::name}} → name
 * - [ 🖼 | name ] → name
 * - <img="name"> → name
 * - name → name
 */
function cleanAssetTag(tag: string): string | null {
  return unwrapAssetToken(tag)
}

/**
 * Find exact match in asset aliases
 */
function findExactMatch(tag: string, assets: CharacterAsset[]): CharacterAsset | null {
  for (const asset of assets) {
    if (!asset.metadata?.aliases) {
      continue
    }

    for (const alias of asset.metadata.aliases) {
      if (alias === tag) {
        return asset
      }
    }
  }

  for (const asset of assets) {
    if (asset.display_name === tag || asset.file_name === tag || asset.canonical_name === tag) {
      return asset
    }
  }

  return null
}

/**
 * Find normalized match (case-insensitive, space/underscore agnostic)
 */
function findNormalizedMatch(tag: string, assets: CharacterAsset[]): CharacterAsset | null {
  const normalizedTag = normalizeAssetKey(tag)
  const looseTag = normalizeAssetKeyLoose(tag)
  if (!normalizedTag) {
    return null
  }

  for (const asset of assets) {
    // Check aliases
    if (asset.metadata?.aliases) {
      for (const alias of asset.metadata.aliases) {
        const normalizedAlias = normalizeAssetKey(alias)
        const looseAlias = normalizeAssetKeyLoose(alias)
        if (normalizedAlias === normalizedTag || (looseTag && looseAlias === looseTag)) {
          return asset
        }
      }
    }

    // Check file_name
    const normalizedFileName = normalizeAssetKey(asset.file_name)
    const looseFileName = normalizeAssetKeyLoose(asset.file_name)
    if (normalizedFileName === normalizedTag || (looseTag && looseFileName === looseTag)) {
      return asset
    }
  }

  for (const asset of assets) {
    const normalizedDisplayName = asset.display_name ? normalizeAssetKey(asset.display_name) : null
    const looseDisplayName = asset.display_name ? normalizeAssetKeyLoose(asset.display_name) : null
    if (normalizedDisplayName === normalizedTag || (looseTag && looseDisplayName === looseTag)) {
      return asset
    }
  }

  for (const asset of assets) {
    const normalizedCanonicalName = asset.canonical_name
      ? normalizeAssetKey(asset.canonical_name)
      : null
    const looseCanonicalName = asset.canonical_name
      ? normalizeAssetKeyLoose(asset.canonical_name)
      : null
    if (
      normalizedCanonicalName === normalizedTag ||
      (looseTag && looseCanonicalName === looseTag)
    ) {
      return asset
    }
  }

  return null
}

function sortAssetsForResolution(assets: CharacterAsset[]): CharacterAsset[] {
  if (assets.length <= 1) {
    return assets
  }

  return [...assets].sort((a, b) => {
    const aOrder = a.display_order ?? Number.MAX_SAFE_INTEGER
    const bOrder = b.display_order ?? Number.MAX_SAFE_INTEGER
    if (aOrder !== bOrder) {
      return aOrder - bOrder
    }
    return 0
  })
}

/**
 * Find prefix match for emotion variants
 *
 * Examples:
 * - "Angelika_sad" → matches "Angelika_sad_1", "Angelika_sad_2"
 * - "Ra-on.indifferent" → matches "Ra-on.indifferent.1"
 * - "Choi Yoo-jin" → matches "Choi Yoo-jin worried"
 *
 * Randomly selects one variant if multiple matches found.
 */
function findPrefixMatch(tag: string, assets: CharacterAsset[]): CharacterAsset | null {
  const variants: CharacterAsset[] = []

  for (const asset of assets) {
    // Check aliases
    if (asset.metadata?.aliases) {
      for (const alias of asset.metadata.aliases) {
        // Numbered variants (underscore or dot + digit)
        if (
          (alias.startsWith(tag + '_') || alias.startsWith(tag + '.')) &&
          /[._]\d+(\.[a-z0-9]+)?$/i.test(alias)
        ) {
          variants.push(asset)
          break
        }

        // Space-separated variants (e.g., "Name emotion")
        if (alias.startsWith(tag + ' ')) {
          variants.push(asset)
          break
        }
      }
    }

    const variantCandidates = [asset.file_name, asset.canonical_name].filter(
      (value): value is string => Boolean(value),
    )

    for (const candidate of variantCandidates) {
      if (
        ((candidate.startsWith(tag + '_') || candidate.startsWith(tag + '.')) &&
          /[._]\d+(\.[a-z0-9]+)?$/i.test(candidate)) ||
        candidate.startsWith(tag + ' ')
      ) {
        variants.push(asset)
        break
      }
    }
  }

  if (variants.length === 0) {
    return null
  }

  // Randomly select one variant (RisuAI behavior)
  const randomIndex = Math.floor(Math.random() * variants.length)
  return variants[randomIndex]
}

/**
 * Build public URL for asset
 */
function buildPublicUrl(asset: CharacterAsset, context: AssetResolutionContext): string {
  const bucketName = context.bucketName || 'character-assets'
  const baseUrl = context.storageBaseUrl.replace(/\/$/, '')
  const path = asset.storage_path.replace(/^\//, '')

  return `${baseUrl}/storage/v1/object/public/${bucketName}/${path}`
}

/**
 * Resolve multiple asset tags in batch
 *
 * Useful for pre-resolving all assets in a conversation.
 */
export function resolveAssetTags(
  tags: string[],
  context: AssetResolutionContext,
): Map<string, AssetResolutionResult> {
  const results = new Map<string, AssetResolutionResult>()

  for (const tag of tags) {
    const result = resolveAssetTag(tag, context)
    if (result) {
      results.set(tag, result)
    }
  }

  return results
}

/**
 * Extract all asset tags from text
 *
 * Supports:
 * - ![alt](asset:tag)
 * - [ 🖼 | tag ]
 * - {{image::tag}}
 * - {{img::tag}}
 * - <img="tag">
 */
export function extractAssetTags(text: string): string[] {
  return extractAssetTokens(text)
}

// ============================================================================
// Asset URL Map (Single Source of Truth for fast lookups)
// ============================================================================

export interface AssetUrlMapOptions {
  /** Supabase storage instance for generating public URLs */
  getPublicUrl: (storagePath: string) => string
}

/**
 * Build a flat key → URL map from character assets.
 *
 * This is the single source of truth for asset URL resolution.
 * Keys are registered with multiple variations for flexible matching:
 * - Original key
 * - Normalized key (lowercase, no protocol prefixes)
 * - Base filename (without path)
 * - Normalized base filename
 *
 * @param assets - Character assets from database
 * @param options - Configuration options
 * @returns Flat map of asset key → public URL
 */
export function buildAssetUrlMap(
  assets: CharacterAsset[],
  options: AssetUrlMapOptions,
): Record<string, string> {
  const urlMap: Record<string, string> = {}

  // Hoisted outside loop for performance (avoids creating new function per asset)
  const registerKey = (key: string | null | undefined, publicUrl: string) => {
    if (!key) return

    // Register original key
    urlMap[key] = publicUrl

    // Register normalized key
    const normalized = normalizeAssetKey(key)
    if (normalized && normalized !== key) {
      urlMap[normalized] = publicUrl
    }
    const looseNormalized = normalizeAssetKeyLoose(key)
    if (looseNormalized && looseNormalized !== normalized && looseNormalized !== key) {
      urlMap[looseNormalized] = publicUrl
    }

    // Register fuzzy key (underscores removed) for RisuAI compatibility
    // Handles cases like "lifting_skirt" matching "liftingskirt"
    registerLegacyCompatibleAssetUrlKeys(urlMap, key, publicUrl)

    // Register base filename (without path)
    const baseName = key.split('/').pop()
    if (baseName && baseName !== key) {
      urlMap[baseName] = publicUrl
      const normalizedBase = normalizeAssetKey(baseName)
      if (normalizedBase && normalizedBase !== baseName) {
        urlMap[normalizedBase] = publicUrl
      }
      const looseBase = normalizeAssetKeyLoose(baseName)
      if (
        looseBase &&
        looseBase !== normalizedBase &&
        looseBase !== baseName &&
        looseBase !== key
      ) {
        urlMap[looseBase] = publicUrl
      }
      registerLegacyCompatibleAssetUrlKeys(urlMap, baseName, publicUrl)
    }
  }

  for (const asset of assets) {
    const publicUrl = options.getPublicUrl(asset.storage_path)

    // Register file_name, display_name, and canonical_name
    registerKey(asset.file_name, publicUrl)
    registerKey(asset.display_name, publicUrl)
    registerKey(asset.canonical_name, publicUrl)

    // Register all aliases from metadata
    const metadata = asset.metadata as AssetMetadata | null
    if (metadata?.aliases && Array.isArray(metadata.aliases)) {
      for (const alias of metadata.aliases) {
        registerKey(alias, publicUrl)
      }
    }
  }

  return urlMap
}

/**
 * Resolve asset URL from pre-built URL map.
 *
 * This is a fast O(1) lookup that should be used for most cases.
 * Falls back to normalized lookup if exact match not found.
 *
 * @param source - Asset name/path to resolve
 * @param assetUrlMap - Pre-built URL map from buildAssetUrlMap()
 * @returns Public URL if found, undefined otherwise
 */
export function resolveAssetUrl(
  source: string,
  assetUrlMap: Record<string, string>,
): string | undefined {
  if (!assetUrlMap || !source) return undefined

  // Debug: only log for unicon assets to reduce noise
  // Try direct lookup first (most common case)
  const direct = assetUrlMap[source]
  if (direct) {
    return direct
  }

  // Try normalized lookup
  const normalized = normalizeAssetKey(source)
  if (normalized) {
    const normalizedMatch = assetUrlMap[normalized]
    if (normalizedMatch) {
      return normalizedMatch
    }
  }
  const looseNormalized = normalizeAssetKeyLoose(source)
  if (looseNormalized) {
    const looseMatch = assetUrlMap[looseNormalized]
    if (looseMatch) {
      return looseMatch
    }
  }

  // Try base filename lookup
  const base = source.split('/').pop()
  if (base && base !== source) {
    const baseMatch = assetUrlMap[base]
    if (baseMatch) return baseMatch

    const normalizedBase = normalizeAssetKey(base)
    if (normalizedBase) {
      const normalizedBaseMatch = assetUrlMap[normalizedBase]
      if (normalizedBaseMatch) return normalizedBaseMatch
    }

    const looseBase = normalizeAssetKeyLoose(base)
    if (looseBase) {
      const looseBaseMatch = assetUrlMap[looseBase]
      if (looseBaseMatch) return looseBaseMatch
    }
  }

  const legacyCompatibleMatch = resolveLegacyCompatibleAssetUrl(source, assetUrlMap)
  if (legacyCompatibleMatch) {
    return legacyCompatibleMatch
  }

  return undefined
}

const LOOSE_IMAGE_EXTENSION_REGEX = /\.(png|webp|jpg|jpeg|gif|avif|mp4|webm)$/i

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
