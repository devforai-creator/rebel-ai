import { describe, expect, it, vi } from 'vitest'
import {
  applyCharacterAvatarUrlMap,
  resolveCharacterAvatarUrlMap,
  resolveSingleCharacterAvatarUrl,
} from './character-avatar'

function createSupabaseMock(options?: {
  rows?: Array<{ character_id: string; storage_path: string; display_order: number | null }>
  selectError?: { message: string }
  signedUrlError?: { message: string }
}) {
  const createSignedUrls = vi.fn(async (paths: string[]) => {
    if (options?.signedUrlError) {
      return { data: null, error: options.signedUrlError }
    }

    return {
      data: paths.map((path) => ({
        path,
        signedUrl: `https://signed.test/${path}?token=abc`,
      })),
      error: null,
    }
  })

  const builder = {
    select: vi.fn(() => builder),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    then: (onfulfilled: (value: unknown) => unknown) =>
      Promise.resolve({
        data: options?.rows ?? [],
        error: options?.selectError ?? null,
      }).then(onfulfilled),
  }

  const supabase = {
    from: vi.fn(() => builder),
    storage: {
      from: vi.fn(() => ({
        createSignedUrls,
      })),
    },
  }

  return {
    supabase,
    createSignedUrls,
  }
}

describe('resolveCharacterAvatarUrlMap', () => {
  it('prefers signed icon asset URLs over stored avatar_url values', async () => {
    const { supabase, createSignedUrls } = createSupabaseMock({
      rows: [
        {
          character_id: 'char-1',
          storage_path: 'user/char-1/icon.webp',
          display_order: 0,
        },
      ],
    })

    const result = await resolveCharacterAvatarUrlMap(supabase as never, [
      { id: 'char-1', avatar_url: 'https://legacy.example/avatar.webp' },
      { id: 'char-2', avatar_url: null },
    ])

    expect(createSignedUrls).toHaveBeenCalledWith(['user/char-1/icon.webp'], 60 * 60 * 24)
    expect(result).toEqual({
      'char-1': 'https://signed.test/user/char-1/icon.webp?token=abc',
      'char-2': null,
    })
  })

  it('falls back to stored avatar_url when signing fails', async () => {
    const { supabase } = createSupabaseMock({
      rows: [
        {
          character_id: 'char-1',
          storage_path: 'user/char-1/icon.webp',
          display_order: 0,
        },
      ],
      signedUrlError: { message: 'sign failed' },
    })

    const result = await resolveCharacterAvatarUrlMap(supabase as never, [
      { id: 'char-1', avatar_url: 'https://legacy.example/avatar.webp' },
    ])

    expect(result).toEqual({
      'char-1': 'https://legacy.example/avatar.webp',
    })
  })
})

describe('resolveSingleCharacterAvatarUrl', () => {
  it('returns the signed avatar URL for one character', async () => {
    const { supabase } = createSupabaseMock({
      rows: [
        {
          character_id: 'char-1',
          storage_path: 'user/char-1/icon.webp',
          display_order: 0,
        },
      ],
    })

    await expect(
      resolveSingleCharacterAvatarUrl(supabase as never, {
        id: 'char-1',
        avatar_url: null,
      }),
    ).resolves.toBe('https://signed.test/user/char-1/icon.webp?token=abc')
  })
})

describe('applyCharacterAvatarUrlMap', () => {
  it('applies resolved URLs without changing unrelated fields', () => {
    const result = applyCharacterAvatarUrlMap(
      [
        {
          id: 'char-1',
          name: 'Guide',
          avatar_url: null,
        },
      ],
      {
        'char-1': 'https://signed.test/user/char-1/icon.webp?token=abc',
      },
    )

    expect(result).toEqual([
      {
        id: 'char-1',
        name: 'Guide',
        avatar_url: 'https://signed.test/user/char-1/icon.webp?token=abc',
      },
    ])
  })
})
