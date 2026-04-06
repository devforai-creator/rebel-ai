/**
 * SUU Asset Bridge
 *
 * Transforms `ui_card.assets` (which use `@assets/filename.png` paths) into
 * the URL map format that `@safe-ugc-ui/react`'s `UGCRenderer` expects.
 *
 * SUU's internal `resolveAsset(path, assets)` looks up by:
 *   1. Full path: assets["@assets/portrait.png"]
 *   2. Stripped key: assets["portrait.png"]
 *
 * So we register both forms as keys in the returned map.
 *
 * Uses RebelAI's existing 4-tier asset resolution (exact → normalized → loose
 * → fuzzy + extension fallback) to resolve filenames to actual Supabase URLs.
 */

import { resolveAssetUrl } from '@/lib/asset-resolver'

/**
 * Build an asset map for UGCRenderer from ui_card.assets and the existing
 * RebelAI asset URL map.
 *
 * ui_card.assets maps logical names to @assets/ paths:
 *   { "portrait": "@assets/portrait.png", "bg": "@assets/background.webp" }
 *
 * UGCRenderer's resolveAsset() expects the asset map keyed by the path
 * that card nodes use in their `src` fields (e.g. "@assets/portrait.png").
 *
 * @param uiCardAssets - The assets field from ui_card JSON
 * @param assetUrlMap - Pre-built asset name → URL map from the chat assets API
 * @returns Asset map keyed by both @assets/... and bare filename
 */
export function buildSuuAssetMap(
  uiCardAssets: Record<string, string> | undefined | null,
  assetUrlMap: Record<string, string>,
): Record<string, string> {
  if (!uiCardAssets || typeof uiCardAssets !== 'object') return {}

  const result: Record<string, string> = {}

  for (const [, path] of Object.entries(uiCardAssets)) {
    if (typeof path !== 'string') continue

    // Strip @assets/ prefix to get bare filename for resolution
    const filename = path.replace(/^@assets\//, '')

    // Use multi-tier resolution (handles case/extension/separator mismatches)
    const url = resolveAssetUrl(filename, assetUrlMap)
    if (url) {
      // Register both key forms that SUU's resolveAsset() checks:
      // 1. Full @assets/ path (primary lookup)
      const fullPath = path.startsWith('@assets/') ? path : `@assets/${path}`
      result[fullPath] = url
      // 2. Bare filename (fallback lookup)
      result[filename] = url
    }
  }

  return result
}
