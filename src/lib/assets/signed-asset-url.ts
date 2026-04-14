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
    return {}
  }

  const urlMap: Record<string, string> = {}

  for (let index = 0; index < uniquePaths.length; index += 1) {
    const requestedPath = uniquePaths[index]
    const signedEntry = data?.[index]
    const resolvedPath =
      typeof signedEntry?.path === 'string' && signedEntry.path.trim().length > 0
        ? signedEntry.path
        : requestedPath

    if (typeof signedEntry?.signedUrl === 'string' && signedEntry.signedUrl.length > 0) {
      urlMap[resolvedPath] = signedEntry.signedUrl
    }
  }

  return urlMap
}
