import { buildAssetUrlMap, normalizeAssetKey } from '@/lib/asset-resolver'
import type { CharacterAssetRecord, ModuleAssetSummary, ModuleRegexEntry } from './asset-queries'

export type GlobalVariableRecord = {
  key: string
  value: unknown
}

type CharacterMetadata = {
  image_commands?: Record<string, string>
  character_list?: string[] | string
}

type BuildChatAssetPayloadOptions = {
  characterAssets: CharacterAssetRecord[]
  characterAssetUrlMapByPath: Record<string, string>
  characterMetadata?: CharacterMetadata | null
  moduleAssetUrls: Record<string, string>
  moduleRegex: ModuleRegexEntry[]
  moduleAssetSummary: ModuleAssetSummary[]
  globalVariables: Record<string, unknown>
}

export function reduceGlobalVariables(
  entries: GlobalVariableRecord[] | null | undefined,
): Record<string, unknown> {
  return (entries ?? []).reduce(
    (accumulator, entry) => {
      if (entry?.key) {
        accumulator[entry.key] = entry.value
      }
      return accumulator
    },
    {} as Record<string, unknown>,
  )
}

export function buildChatAssetPayload({
  characterAssets,
  characterAssetUrlMapByPath,
  characterMetadata,
  moduleAssetUrls,
  moduleRegex,
  moduleAssetSummary,
  globalVariables,
}: BuildChatAssetPayloadOptions) {
  const assetUrlMap = buildAssetUrlMap(characterAssets, {
    getAssetUrl: (storagePath: string) => characterAssetUrlMapByPath[storagePath],
  })

  for (const [name, url] of Object.entries(moduleAssetUrls)) {
    if (!assetUrlMap[name]) {
      assetUrlMap[name] = url
    }
  }

  const assetIdToUrl = new Map<string, string>()
  const shortAliasToUrl = new Map<string, string>()
  const canonicalNames = new Map<string, string>()

  for (const asset of characterAssets) {
    const assetUrl = characterAssetUrlMapByPath[asset.storage_path]
    if (!assetUrl) {
      continue
    }

    assetIdToUrl.set(asset.id, assetUrl)

    if (!asset.canonical_name) {
      continue
    }

    const normalizedCanonicalKey = asset.canonical_name.toLowerCase().replace(/[\s_-]+/g, '_')
    const existingCanonical = canonicalNames.get(normalizedCanonicalKey)
    if (!existingCanonical) {
      canonicalNames.set(normalizedCanonicalKey, asset.canonical_name)
    } else if (/[A-Z]/.test(asset.canonical_name) && !/[A-Z]/.test(existingCanonical)) {
      canonicalNames.set(normalizedCanonicalKey, asset.canonical_name)
    }

    const extensionMatch = asset.canonical_name.match(/\.(png|webp|jpg|jpeg|gif|avif)$/i)
    const extension = extensionMatch ? extensionMatch[0] : ''
    const baseName = extension
      ? asset.canonical_name.slice(0, -extension.length)
      : asset.canonical_name
    const prefixMatch = baseName.match(/^([a-zA-Z가-힣]+)[_\s](.+)$/)

    if (!prefixMatch) {
      continue
    }

    const prefix = prefixMatch[1]
    const descriptor = prefixMatch[2]
    const words = descriptor.split(/[\s_]+/).filter((word) => word.length >= 2)

    for (const word of words) {
      registerShortAlias({
        canonicalNames,
        shortAliasToUrl,
        alias: `${prefix}_${word}${extension}`,
        assetUrl,
      })

      for (const stem of generateWordStems(word)) {
        registerShortAlias({
          canonicalNames,
          shortAliasToUrl,
          alias: `${prefix}_${stem}${extension}`,
          assetUrl,
        })
      }
    }
  }

  for (const [alias, url] of shortAliasToUrl) {
    if (!assetUrlMap[alias]) {
      assetUrlMap[alias] = url
    }
  }

  const imageCommandUrlMap = buildImageCommandUrlMap({
    characterAssets,
    characterMetadata,
    assetIdToUrl,
  })

  return {
    characterAssets,
    assetUrlMap,
    imageCommandUrlMap,
    moduleRegex,
    moduleAssetSummary,
    globalVariables,
  }
}

function buildImageCommandUrlMap({
  characterAssets,
  characterMetadata,
  assetIdToUrl,
}: {
  characterAssets: CharacterAssetRecord[]
  characterMetadata?: CharacterMetadata | null
  assetIdToUrl: Map<string, string>
}): Record<string, string> {
  const imageCommandUrlMap: Record<string, string> = {}

  if (characterMetadata?.image_commands && typeof characterMetadata.image_commands === 'object') {
    for (const [command, assetId] of Object.entries(characterMetadata.image_commands)) {
      if (!command || !assetId) {
        continue
      }

      const assetUrl = assetIdToUrl.get(assetId)
      if (!assetUrl) {
        continue
      }

      imageCommandUrlMap[command] = assetUrl
      const normalized = normalizeAssetKey(command)
      if (normalized) {
        imageCommandUrlMap[normalized] = assetUrl
      }
    }
  }

  const characterList = characterMetadata?.character_list
  if (!characterList) {
    return imageCommandUrlMap
  }

  const commandNames = Array.isArray(characterList)
    ? characterList
    : String(characterList)
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)

  if (commandNames.length === 0) {
    return imageCommandUrlMap
  }

  const orderedAssets = characterAssets.filter((asset) => !asset.file_name.startsWith('1.'))
  for (let index = 0; index < commandNames.length && index < orderedAssets.length; index += 1) {
    const command = commandNames[index]
    const normalized = normalizeAssetKey(command)
    if (imageCommandUrlMap[command] || (normalized && imageCommandUrlMap[normalized])) {
      continue
    }

    const assetUrl = assetIdToUrl.get(orderedAssets[index].id)
    if (!assetUrl) {
      continue
    }

    imageCommandUrlMap[command] = assetUrl
    if (normalized) {
      imageCommandUrlMap[normalized] = assetUrl
    }
  }

  return imageCommandUrlMap
}

function registerShortAlias({
  canonicalNames,
  shortAliasToUrl,
  alias,
  assetUrl,
}: {
  canonicalNames: Map<string, string>
  shortAliasToUrl: Map<string, string>
  alias: string
  assetUrl: string
}) {
  const normalizedAliasKey = alias.toLowerCase().replace(/[\s_-]+/g, '_')
  if (canonicalNames.has(normalizedAliasKey)) {
    return
  }

  canonicalNames.set(normalizedAliasKey, alias)
  shortAliasToUrl.set(alias, assetUrl)
  shortAliasToUrl.set(alias.toLowerCase(), assetUrl)
}

function generateWordStems(word: string): string[] {
  const lowerWord = word.toLowerCase()
  const stems: string[] = []
  const suffixRules: Array<[RegExp, string | null]> = [
    [/ingly$/i, null],
    [/edly$/i, null],
    [/ly$/i, ''],
    [/ing$/i, ''],
    [/ed$/i, ''],
    [/ness$/i, 'y'],
    [/ment$/i, ''],
    [/tion$/i, 't'],
    [/ful$/i, ''],
    [/less$/i, ''],
  ]

  for (const [pattern, replacement] of suffixRules) {
    if (!pattern.test(lowerWord)) {
      continue
    }

    const stem = lowerWord.replace(pattern, replacement ?? '')
    if (stem.length >= 3 && stem !== lowerWord) {
      stems.push(stem)
    }
    break
  }

  return stems
}
