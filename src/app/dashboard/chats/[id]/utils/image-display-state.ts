import {
  normalizeAssetKey,
  resolveAssetTag,
  resolveAssetUrl,
  type CharacterAsset,
} from '@/lib/asset-resolver'

type EmotionResolutionSource = 'image_command' | 'asset_tag' | 'asset_url_map'

export type EmotionRenderTarget = {
  rawTag: string
  resolvedUrl: string
  resolvedBy: EmotionResolutionSource
  asset?: CharacterAsset
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  return trimmed || undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function buildPublicCharacterAssetUrl(
  storageBaseUrl: string,
  storagePath: string | undefined,
): string | undefined {
  if (!storageBaseUrl || !storagePath) {
    return undefined
  }

  const base = storageBaseUrl.replace(/\/$/, '')
  const path = storagePath.replace(/^\//, '')
  return `${base}/storage/v1/object/public/character-assets/${path}`
}

function getAssetCandidateKeys(asset: CharacterAsset): string[] {
  const keys = [asset.file_name, asset.display_name, asset.canonical_name]
  const aliases = Array.isArray(asset.metadata?.aliases)
    ? asset.metadata.aliases.filter((value): value is string => typeof value === 'string')
    : []

  return [...keys, ...aliases].filter((value): value is string => Boolean(value))
}

function findAssetByResolvedUrl(
  resolvedUrl: string,
  characterAssets: CharacterAsset[],
  assetUrlMap: Record<string, string> | undefined,
  storageBaseUrl: string,
): CharacterAsset | undefined {
  for (const asset of characterAssets) {
    if (assetUrlMap) {
      for (const candidate of getAssetCandidateKeys(asset)) {
        if (resolveAssetUrl(candidate, assetUrlMap) === resolvedUrl) {
          return asset
        }
      }
    }

    const publicUrl = buildPublicCharacterAssetUrl(storageBaseUrl, asset.storage_path)
    if (publicUrl === resolvedUrl) {
      return asset
    }
  }

  return undefined
}

function extractImageDisplayMetadata(asset: CharacterAsset | undefined) {
  if (!asset || !isRecord(asset.metadata)) {
    return undefined
  }

  const raw = asRecord(asset.metadata.image_display) ?? asRecord(asset.metadata.ui)
  if (!raw) {
    return undefined
  }

  return {
    character: asString(raw.character),
    variant: asString(raw.variant),
    theme: asString(raw.theme),
    flags: asRecord(raw.flags),
    tokens: asRecord(raw.tokens),
  }
}

function parseCanonicalParts(value: string | null | undefined) {
  const source = asString(value)
  if (!source) {
    return {}
  }

  const withoutExtension = source.replace(/\.(png|webp|jpg|jpeg|gif|avif)$/i, '').trim()
  if (!withoutExtension) {
    return {}
  }

  let character: string | undefined
  let variant: string | undefined
  let theme: string | undefined

  const pipeParts = withoutExtension
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)

  if (pipeParts.length >= 2) {
    character = pipeParts[0]
    variant = pipeParts[pipeParts.length - 1]
    if (pipeParts.length >= 3) {
      theme = pipeParts[1]
    }
  } else {
    for (const separator of ['_', '.', ' ']) {
      const index = withoutExtension.lastIndexOf(separator)
      if (index <= 0 || index >= withoutExtension.length - 1) {
        continue
      }

      const left = withoutExtension.slice(0, index).trim()
      const right = withoutExtension.slice(index + 1).trim()
      if (!left || !right) {
        continue
      }

      character = left
      variant = right
      if (separator !== ' ') {
        break
      }
    }
  }

  const flags: Record<string, unknown> = {}
  if (/(^|[\s_.|/-])(nsfw|nude|naked|lewd|ero)($|[\s_.|/-])/i.test(withoutExtension)) {
    flags.nsfw = true
  }

  return {
    ...(character ? { character } : {}),
    ...(variant ? { variant } : {}),
    ...(theme ? { theme } : {}),
    ...(Object.keys(flags).length > 0 ? { flags } : {}),
  }
}

export function resolveEmotionRenderTarget(options: {
  rawTag: string
  characterAssets: CharacterAsset[]
  assetUrlMap?: Record<string, string>
  imageCommandUrlMap?: Record<string, string>
  storageBaseUrl: string
}): EmotionRenderTarget | null {
  const rawTag = options.rawTag.trim()
  if (!rawTag) {
    return null
  }

  const normalizedTag = normalizeAssetKey(rawTag)
  const resolvedFromCommand =
    options.imageCommandUrlMap?.[rawTag] ||
    (normalizedTag ? options.imageCommandUrlMap?.[normalizedTag] : undefined)

  if (resolvedFromCommand) {
    const asset =
      resolveAssetTag(rawTag, {
        assets: options.characterAssets,
        storageBaseUrl: options.storageBaseUrl,
        bucketName: 'character-assets',
      })?.asset ??
      findAssetByResolvedUrl(
        resolvedFromCommand,
        options.characterAssets,
        options.assetUrlMap,
        options.storageBaseUrl,
      )

    return {
      rawTag,
      resolvedUrl: resolvedFromCommand,
      resolvedBy: 'image_command',
      ...(asset ? { asset } : {}),
    }
  }

  const resolvedAsset = resolveAssetTag(rawTag, {
    assets: options.characterAssets,
    storageBaseUrl: options.storageBaseUrl,
    bucketName: 'character-assets',
  })
  if (resolvedAsset) {
    return {
      rawTag,
      resolvedUrl: resolvedAsset.url,
      resolvedBy: 'asset_tag',
      asset: resolvedAsset.asset,
    }
  }

  const resolvedFromUrlMap = options.assetUrlMap
    ? resolveAssetUrl(rawTag, options.assetUrlMap)
    : undefined
  if (!resolvedFromUrlMap) {
    return null
  }

  const asset = findAssetByResolvedUrl(
    resolvedFromUrlMap,
    options.characterAssets,
    options.assetUrlMap,
    options.storageBaseUrl,
  )

  return {
    rawTag,
    resolvedUrl: resolvedFromUrlMap,
    resolvedBy: 'asset_url_map',
    ...(asset ? { asset } : {}),
  }
}

export function buildImageDisplayState(target: EmotionRenderTarget): Record<string, unknown> {
  const metadata = extractImageDisplayMetadata(target.asset)
  const parsed = parseCanonicalParts(target.asset?.canonical_name ?? target.rawTag)
  const flags = {
    ...(parsed.flags ?? {}),
    ...(metadata?.flags ?? {}),
  }

  const imageState: Record<string, unknown> = {
    rawTag: target.rawTag,
    resolvedUrl: target.resolvedUrl,
    resolvedBy: target.resolvedBy,
  }

  if (target.asset) {
    imageState.assetId = target.asset.id
    imageState.fileName = target.asset.file_name
    imageState.displayName = target.asset.display_name ?? null
    imageState.canonicalName = target.asset.canonical_name ?? null
    imageState.asset = {
      id: target.asset.id,
      fileName: target.asset.file_name,
      displayName: target.asset.display_name ?? null,
      canonicalName: target.asset.canonical_name ?? null,
    }
  }

  const character = metadata?.character ?? parsed.character
  if (character) {
    imageState.character = character
  }

  const variant = metadata?.variant ?? parsed.variant
  if (variant) {
    imageState.variant = variant
  }

  const theme = metadata?.theme ?? parsed.theme
  if (theme) {
    imageState.theme = theme
  }

  if (Object.keys(flags).length > 0) {
    imageState.flags = flags
  }

  if (metadata?.tokens && Object.keys(metadata.tokens).length > 0) {
    imageState.tokens = metadata.tokens
  }

  return {
    runtime: {
      image: imageState,
    },
  }
}
