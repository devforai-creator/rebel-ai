/**
 * Normalize asset identifiers so image references resolve
 * regardless of protocol prefixes, casing, or extra paths.
 */
export function normalizeAssetKey(value?: string | null): string | null {
  if (!value) {
    return null
  }

  let key = value.trim()
  if (!key) {
    return null
  }

  // Strip surrounding quotes that might leak from HTML attributes
  key = key.replace(/^["']|["']$/g, '')

  // Remove legacy import/runtime prefixes
  key = key
    .replace(/^embeded:\/\//i, '')
    .replace(/^embedded:\/\//i, '')
    .replace(/^__asset:/i, '')
    .replace(/^asset:\/\//i, '')
    .replace(/^ccdefault:/i, '')

  // Normalize slashes and drop redundant separators
  key = key.replace(/\\/g, '/')
  key = key.replace(/^\.?\//, '')
  key = key.replace(/\/+/g, '/')

  // Remove query/hash fragments
  const [cleanPath] = key.split(/[?#]/)

  // Normalize spaces, underscores, hyphens, and pipes to a consistent format
  // This allows "blushing shyly" to match "blushing_shyly" or "blushing-shyly"
  // Also handles LLM output format like "Belle | Clothed | pouting" → "belle_clothed_pouting"
  const normalized = cleanPath
    .trim()
    .toLowerCase()
    .replace(/[\s_\-|]+/g, '_') // Normalize all separators to underscore (including pipe)

  return normalized || null
}
