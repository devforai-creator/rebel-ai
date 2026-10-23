const MARKDOWN_ASSET_IMAGE_PREFIX_REGEX_SOURCE = String.raw`!\[([^\]]*)\]\(\s*asset:`
const LEGACY_MMG_REGEX = /<mmg\s*="([^"]+)"\s*>/gi
const LEGACY_IMG_EQUALS_REGEX = /<img\s*=\s*["']?(.+?)["']?\s*>/gi
const LEGACY_IMG_SRC_REGEX = /<img\s+src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))\s*\/?>/gi
const LEGACY_EMOJI_IMAGE_REGEX = /\[\s*🖼\s*\|\s*(.+?)\s*\]/g
const LEGACY_IMAGE_TEMPLATE_REGEX = /\{\{image::(.+?)\}\}/g
const LEGACY_IMG_TEMPLATE_REGEX = /\{\{img::(.+?)\}\}/g

export type CanonicalAssetImageTokenMatch = Readonly<{
  raw: string
  altText: string
  assetKey: string
  index: number
}>

function scanCanonicalAssetImageTokens(text: string): CanonicalAssetImageTokenMatch[] {
  const matches: CanonicalAssetImageTokenMatch[] = []
  const regex = new RegExp(MARKDOWN_ASSET_IMAGE_PREFIX_REGEX_SOURCE, 'gi')
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const keyStart = regex.lastIndex
    let depth = 0
    let cursor = keyStart

    for (; cursor < text.length; cursor++) {
      const char = text[cursor]
      // An incomplete token must not swallow the next image token.
      if (char === '!' && text[cursor + 1] === '[') {
        break
      }

      if (char === '(') {
        depth++
      } else if (char === ')') {
        if (depth > 0) {
          depth--
          continue
        }

        const assetKey = text.slice(keyStart, cursor).trim()
        cursor++
        matches.push({
          raw: text.slice(match.index, cursor),
          altText: match[1].trim() || assetKey,
          assetKey,
          index: match.index,
        })
        break
      }
    }

    regex.lastIndex = cursor
  }

  return matches
}

function sanitizeAltText(value: string): string {
  return value.replace(/[\r\n[\]]+/g, ' ').trim()
}

function getNormalizableLegacyAssetSource(assetKey: string): string | null {
  const normalized = assetKey.trim()
  if (!normalized || /^(https?:\/\/|data:)/i.test(normalized)) {
    return null
  }
  return normalized
}

export function buildCanonicalAssetImageToken(assetKey: string, altText?: string): string {
  const normalizedKey = assetKey.trim()
  const normalizedAlt = sanitizeAltText(altText ?? normalizedKey)
  return `![${normalizedAlt}](asset:${normalizedKey})`
}

export function normalizeLegacyAssetImageTokens(text: string): string {
  if (!text) return text

  let normalized = text

  normalized = normalized.replace(LEGACY_MMG_REGEX, (_match, assetKey: string) =>
    buildCanonicalAssetImageToken(assetKey),
  )
  normalized = normalized.replace(LEGACY_IMG_EQUALS_REGEX, (_match, assetKey: string) =>
    buildCanonicalAssetImageToken(assetKey),
  )
  normalized = normalized.replace(
    LEGACY_IMG_SRC_REGEX,
    (_match, doubleQuoted: string, singleQuoted: string, bare: string) => {
      const assetKey = getNormalizableLegacyAssetSource(doubleQuoted || singleQuoted || bare || '')
      return assetKey ? buildCanonicalAssetImageToken(assetKey) : _match
    },
  )
  normalized = normalized.replace(LEGACY_EMOJI_IMAGE_REGEX, (_match, assetKey: string) =>
    buildCanonicalAssetImageToken(assetKey),
  )
  normalized = normalized.replace(LEGACY_IMAGE_TEMPLATE_REGEX, (_match, assetKey: string) =>
    buildCanonicalAssetImageToken(assetKey),
  )
  normalized = normalized.replace(LEGACY_IMG_TEMPLATE_REGEX, (_match, assetKey: string) =>
    buildCanonicalAssetImageToken(assetKey),
  )
  return normalized
}

export function unwrapAssetToken(tag: string): string | null {
  let cleaned = tag.trim()
  if (!cleaned) {
    return null
  }

  const markdownMatch = scanCanonicalAssetImageTokens(cleaned)[0]
  if (markdownMatch?.raw === cleaned) {
    return markdownMatch.assetKey || null
  }

  const imageTemplateMatch = cleaned.match(/^\{\{image::(.+?)\}\}$/i)
  if (imageTemplateMatch) {
    return imageTemplateMatch[1].trim() || null
  }

  const legacyImgTemplateMatch = cleaned.match(/^\{\{img::(.+?)\}\}$/i)
  if (legacyImgTemplateMatch) {
    return legacyImgTemplateMatch[1].trim() || null
  }

  const emojiMatch = cleaned.match(/^\[\s*🖼\s*\|\s*(.+?)\s*\]$/)
  if (emojiMatch) {
    return emojiMatch[1].trim() || null
  }

  const htmlEqualsMatch = cleaned.match(/^<img\s*=\s*["']?(.+?)["']?\s*>$/i)
  if (htmlEqualsMatch) {
    return htmlEqualsMatch[1].trim() || null
  }

  const htmlSrcMatch = cleaned.match(/^<img\s+src\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))\s*\/?>$/i)
  if (htmlSrcMatch) {
    return (htmlSrcMatch[1] || htmlSrcMatch[2] || htmlSrcMatch[3] || '').trim() || null
  }

  cleaned = cleaned.replace(/^["']|["']$/g, '')
  return cleaned || null
}

export function extractAssetTokens(text: string): string[] {
  const tags = new Set<string>()

  for (const match of collectCanonicalAssetImageTokenMatches(text)) {
    tags.add(match.assetKey)
  }

  for (const match of text.matchAll(LEGACY_EMOJI_IMAGE_REGEX)) {
    const assetKey = match[1]?.trim()
    if (assetKey) tags.add(assetKey)
  }

  for (const match of text.matchAll(LEGACY_IMAGE_TEMPLATE_REGEX)) {
    const assetKey = match[1]?.trim()
    if (assetKey) tags.add(assetKey)
  }

  for (const match of text.matchAll(LEGACY_IMG_TEMPLATE_REGEX)) {
    const assetKey = match[1]?.trim()
    if (assetKey) tags.add(assetKey)
  }

  for (const match of text.matchAll(LEGACY_IMG_EQUALS_REGEX)) {
    const assetKey = match[1]?.trim()
    if (assetKey) tags.add(assetKey)
  }

  for (const match of text.matchAll(LEGACY_IMG_SRC_REGEX)) {
    const assetKey = (match[1] || match[2] || match[3] || '').trim()
    if (assetKey) tags.add(assetKey)
  }

  return Array.from(tags)
}

export function collectCanonicalAssetImageTokenMatches(
  text: string,
): CanonicalAssetImageTokenMatch[] {
  if (!text) {
    return []
  }

  return scanCanonicalAssetImageTokens(text).filter((match) => Boolean(match.assetKey))
}

export function extractCanonicalAssetTokens(text: string): string[] {
  return collectCanonicalAssetImageTokenMatches(text).map((match) => match.assetKey)
}
