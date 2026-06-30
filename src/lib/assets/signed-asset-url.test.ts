import { describe, expect, it, vi } from 'vitest'
import { createSignedAssetUrlMap, PRIVATE_ASSET_URL_TTL_SECONDS } from './signed-asset-url'

function createSupabaseMock(
  responder: (
    paths: string[],
    expiresIn: number,
  ) => {
    data: Array<{ path?: string | null; signedUrl?: string | null }> | null
    error: { message?: string | null } | null
  },
) {
  const createSignedUrls = vi.fn(async (paths: string[], expiresIn: number) =>
    responder(paths, expiresIn),
  )

  return {
    createSignedUrls,
    supabase: {
      storage: {
        from: vi.fn(() => ({
          createSignedUrls,
        })),
      },
    },
  }
}

describe('createSignedAssetUrlMap', () => {
  it('deduplicates paths and keeps the requested key even when storage returns a different path', async () => {
    const { supabase, createSignedUrls } = createSupabaseMock((paths) => ({
      data: paths.map((path, index) => ({
        path: index === 0 ? `${path}?normalized=1` : path,
        signedUrl: `https://signed.test/${path}`,
      })),
      error: null,
    }))

    const result = await createSignedAssetUrlMap(
      supabase,
      'character-assets',
      [' char-1/happy.webp ', 'char-1/happy.webp', 'char-1/sad.webp'],
      {
        logContext: '[Assets Test] sign failed',
      },
    )

    expect(createSignedUrls).toHaveBeenCalledTimes(1)
    expect(createSignedUrls).toHaveBeenCalledWith(
      ['char-1/happy.webp', 'char-1/sad.webp'],
      PRIVATE_ASSET_URL_TTL_SECONDS,
    )
    expect(result).toEqual({
      'char-1/happy.webp': 'https://signed.test/char-1/happy.webp',
      'char-1/happy.webp?normalized=1': 'https://signed.test/char-1/happy.webp',
      'char-1/sad.webp': 'https://signed.test/char-1/sad.webp',
    })
  })

  it('signs asset lists larger than the storage limit in batches of at most 1000', async () => {
    const paths = Array.from({ length: 2453 }, (_, index) => `char-1/asset-${index}.webp`)
    const { supabase, createSignedUrls } = createSupabaseMock((requestedPaths) => ({
      data: requestedPaths.map((path) => ({
        path,
        signedUrl: `https://signed.test/${path}`,
      })),
      error: null,
    }))

    const result = await createSignedAssetUrlMap(supabase, 'character-assets', paths)

    expect(createSignedUrls).toHaveBeenCalledTimes(3)
    expect(createSignedUrls).toHaveBeenNthCalledWith(
      1,
      paths.slice(0, 1000),
      PRIVATE_ASSET_URL_TTL_SECONDS,
    )
    expect(createSignedUrls).toHaveBeenNthCalledWith(
      2,
      paths.slice(1000, 2000),
      PRIVATE_ASSET_URL_TTL_SECONDS,
    )
    expect(createSignedUrls).toHaveBeenNthCalledWith(
      3,
      paths.slice(2000),
      PRIVATE_ASSET_URL_TTL_SECONDS,
    )
    expect(Object.keys(result)).toHaveLength(paths.length)
    expect(result[paths[0]]).toBe(`https://signed.test/${paths[0]}`)
    expect(result[paths.at(-1)!]).toBe(`https://signed.test/${paths.at(-1)!}`)
  })

  it('falls back to per-path signing when the batch request fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { supabase, createSignedUrls } = createSupabaseMock((paths) => {
      if (paths.length > 1) {
        return {
          data: null,
          error: { message: 'batch failed' },
        }
      }

      if (paths[0] === 'char-1/happy.webp') {
        return {
          data: [
            {
              path: paths[0],
              signedUrl: `https://signed.test/${paths[0]}`,
            },
          ],
          error: null,
        }
      }

      return {
        data: null,
        error: { message: 'missing object' },
      }
    })

    const result = await createSignedAssetUrlMap(
      supabase,
      'character-assets',
      ['char-1/happy.webp', 'char-1/missing.webp'],
      {
        logContext: '[Assets Test] sign failed',
      },
    )

    expect(createSignedUrls).toHaveBeenCalledTimes(3)
    expect(createSignedUrls).toHaveBeenNthCalledWith(
      1,
      ['char-1/happy.webp', 'char-1/missing.webp'],
      PRIVATE_ASSET_URL_TTL_SECONDS,
    )
    expect(createSignedUrls).toHaveBeenNthCalledWith(
      2,
      ['char-1/happy.webp'],
      PRIVATE_ASSET_URL_TTL_SECONDS,
    )
    expect(createSignedUrls).toHaveBeenNthCalledWith(
      3,
      ['char-1/missing.webp'],
      PRIVATE_ASSET_URL_TTL_SECONDS,
    )
    expect(result).toEqual({
      'char-1/happy.webp': 'https://signed.test/char-1/happy.webp',
    })
    expect(errorSpy).toHaveBeenCalledWith('[Assets Test] sign failed', {
      bucket: 'character-assets',
      assetCount: 2,
      error: 'batch failed',
    })
    expect(errorSpy).toHaveBeenCalledWith('[Assets Test] sign failed', {
      bucket: 'character-assets',
      assetCount: 1,
      storagePath: 'char-1/missing.webp',
      error: 'missing object',
    })
    errorSpy.mockRestore()
  })
})
