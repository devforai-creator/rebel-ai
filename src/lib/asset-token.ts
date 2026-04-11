const MARKDOWN_ASSET_IMAGE_REGEX_SOURCE = String.raw`!\[([^\]]*)\]\(\s*asset:((?:[^)\s]|\s(?!\)))*[^)\s]?)\s*\)`
const MARKDOWN_ASSET_IMAGE_REGEX = new RegExp(MARKDOWN_ASSET_IMAGE_REGEX_SOURCE, 'gim')
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

export function createCanonicalAssetImageTokenRegex(): RegExp {
  return new RegExp(MARKDOWN_ASSET_IMAGE_REGEX_SOURCE, 'gim')
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

  const markdownMatch = cleaned.match(/^!\[[^\]]*]\(\s*asset:((?:[^)\s]|\s(?!\)))*[^)\s]?)\s*\)$/i)
  if (markdownMatch) {
    return markdownMatch[1].trim() || null
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

  for (const match of text.matchAll(MARKDOWN_ASSET_IMAGE_REGEX)) {
    const assetKey = match[2]?.trim()
    if (assetKey) tags.add(assetKey)
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

  const matches: CanonicalAssetImageTokenMatch[] = []
  const regex = createCanonicalAssetImageTokenRegex()

  for (const match of text.matchAll(regex)) {
    const assetKey = match[2]?.trim()
    if (!assetKey) {
      continue
    }

    matches.push({
      raw: match[0],
      altText: match[1]?.trim() || assetKey,
      assetKey,
      index: match.index ?? 0,
    })
  }

  return matches
}

export function extractCanonicalAssetTokens(text: string): string[] {
  return collectCanonicalAssetImageTokenMatches(text).map((match) => match.assetKey)
}
