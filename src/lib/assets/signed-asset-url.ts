type AssetBucket = 'character-assets' | 'module-assets'

type SignedAssetUrlStorage = {
  storage: {
    from: (bucket: AssetBucket) => {
      createSignedUrls: (
        paths: string[],
        expiresIn: number,
      ) => Promise<{
        data: Array<{ path?: string | null; signedUrl?: string | null }> | null
        error: { message?: string | null } | null
      }>
    }
  }
}

export const PRIVATE_ASSET_URL_TTL_SECONDS = 60 * 60 * 24

export async function createSignedAssetUrlMap(
  supabase: SignedAssetUrlStorage,
  bucket: AssetBucket,
  paths: string[],
  options?: {
    expiresIn?: number
    logContext?: string
  },
): Promise<Record<string, string>> {
  const uniquePaths = Array.from(
    new Set(
      paths
        .filter((path): path is string => typeof path === 'string')
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  )

  if (uniquePaths.length === 0) {
    return {}
  }

  const expiresIn = options?.expiresIn ?? PRIVATE_ASSET_URL_TTL_SECONDS
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(uniquePaths, expiresIn)

  if (error) {
    console.error(options?.logContext ?? '[Assets] Failed to create signed URLs', {
      bucket,
      assetCount: uniquePaths.length,
      error: error.message ?? 'Unknown error',
    })

    if (uniquePaths.length === 1) {
      return {}
    }

    return await createFallbackSignedAssetUrlMap(supabase, bucket, uniquePaths, {
      expiresIn,
      logContext: options?.logContext,
    })
  }

  const urlMap: Record<string, string> = {}
  registerSignedUrlEntries(urlMap, uniquePaths, data)

  return urlMap
}

async function createFallbackSignedAssetUrlMap(
  supabase: SignedAssetUrlStorage,
  bucket: AssetBucket,
  paths: string[],
  options: {
    expiresIn: number
    logContext?: string
  },
): Promise<Record<string, string>> {
  const urlMap: Record<string, string> = {}

  for (const path of paths) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls([path], options.expiresIn)

    if (error) {
      console.error(options.logContext ?? '[Assets] Failed to create signed URLs', {
        bucket,
        assetCount: 1,
        storagePath: path,
        error: error.message ?? 'Unknown error',
      })
      continue
    }

    registerSignedUrlEntries(urlMap, [path], data)
  }

  return urlMap
}

function registerSignedUrlEntries(
  urlMap: Record<string, string>,
  requestedPaths: string[],
  data: Array<{ path?: string | null; signedUrl?: string | null }> | null,
) {
  for (let index = 0; index < requestedPaths.length; index += 1) {
    const requestedPath = requestedPaths[index]
    const signedEntry = data?.[index]
    const signedUrl = signedEntry?.signedUrl?.trim()
    if (!signedUrl) {
      continue
    }

    urlMap[requestedPath] = signedUrl

    const resolvedPath =
      typeof signedEntry?.path === 'string' && signedEntry.path.trim().length > 0
        ? signedEntry.path.trim()
        : null

    if (resolvedPath && resolvedPath !== requestedPath) {
      urlMap[resolvedPath] = signedUrl
    }
  }
}
