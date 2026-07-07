import { describe, expect, it, vi } from 'vitest'

import {
  buildAssetUrlMap,
  extractAssetTags,
  resolveAssetTag,
  resolveAssetTags,
  resolveAssetUrl,
  type AssetResolutionContext,
} from './asset-resolver'

const baseAssets: AssetResolutionContext['assets'] = [
  {
    id: '1',
    file_name: 'Smile.webp',
    storage_path: 'user/Smile.webp',
    display_name: 'Hero Smile',
    metadata: { aliases: ['Smile'] },
  },
  {
    id: '2',
    file_name: 'snow_rim_sad.webp',
    storage_path: 'user/snow_rim_sad.webp',
    display_name: 'Snow Rim Sad',
    canonical_name: 'Snow Rim.sad',
    metadata: { aliases: ['Snow_Rim.Sad'] },
  },
  {
    id: '3',
    file_name: 'sad_1.png',
    storage_path: 'user/sad_1.png',
    display_name: null,
    metadata: { aliases: ['sad_1'] },
  },
  {
    id: '4',
    file_name: 'sad_2.png',
    storage_path: 'user/sad_2.png',
    display_name: null,
    metadata: { aliases: ['sad_2'] },
  },
  {
    id: '5',
    file_name: 'pose.png',
    storage_path: 'user/pose.png',
    display_name: 'Pose',
    metadata: { aliases: ['pose'] },
  },
  {
    id: '6',
    file_name: 'mood_1.png',
    storage_path: 'user/mood_1.png',
    display_name: null,
    metadata: null,
  },
]

const context: AssetResolutionContext = {
  assets: baseAssets,
  storageBaseUrl: 'https://cdn.supabase.co',
}

describe('resolveAssetTag', () => {
  it('resolves canonical markdown asset tags', () => {
    const result = resolveAssetTag('![hero smile](asset:Smile)', context)

    expect(result).toMatchObject({
      asset: expect.objectContaining({ id: '1' }),
      strategy: 'exact',
    })
  })

  it('resolves exact alias from wrapped template tag', () => {
    const result = resolveAssetTag('{{img::Smile}}', context)

    expect(result).toMatchObject({
      asset: expect.objectContaining({ id: '1' }),
      strategy: 'exact',
      url: 'https://cdn.supabase.co/storage/v1/object/public/character-assets/user/Smile.webp',
    })
  })

  it('matches normalized names ignoring case and separators', () => {
    const result = resolveAssetTag('[ 🖼 | snow rim sad ]', context)

    expect(result).toMatchObject({
      asset: expect.objectContaining({ id: '2' }),
      strategy: 'normalized',
    })
  })

  it('matches canonical names in exact and normalized lookups', () => {
    expect(resolveAssetTag('Snow Rim.sad', context)?.asset.id).toBe('2')
    expect(resolveAssetTag('snow rim sad', context)?.asset.id).toBe('2')
  })

  it('uses Math.random for prefix variants when no seed is provided', () => {
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.9) // pick last variant

    try {
      const result = resolveAssetTag('sad', context)

      expect(result).toMatchObject({
        asset: expect.objectContaining({ id: '4' }),
        strategy: 'prefix',
      })
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('uses randomSeed to keep prefix variants stable without calling Math.random', () => {
    const randomSpy = vi.spyOn(Math, 'random')

    try {
      const first = resolveAssetTag('sad', { ...context, randomSeed: 'message-1' })
      const second = resolveAssetTag('sad', { ...context, randomSeed: 'message-1' })

      expect(first).toMatchObject({
        asset: expect.objectContaining({ id: expect.stringMatching(/^[34]$/) }),
        strategy: 'prefix',
      })
      expect(second?.asset.id).toBe(first?.asset.id)
      expect(randomSpy).not.toHaveBeenCalled()
    } finally {
      randomSpy.mockRestore()
    }
  })

  it('batch resolves tags and preserves original keys', () => {
    const results = resolveAssetTags(['Smile', 'sad'], context)

    expect(Array.from(results.keys())).toEqual(['Smile', 'sad'])
    expect(results.get('Smile')?.asset.id).toBe('1')
    expect(results.get('sad')?.strategy).toBe('prefix')
  })

  it('returns null when assets are missing or tag is empty', () => {
    expect(
      resolveAssetTag('', { assets: [], storageBaseUrl: 'https://cdn.supabase.co' }),
    ).toBeNull()
    expect(
      resolveAssetTag('missing', { assets: [], storageBaseUrl: 'https://cdn.supabase.co' }),
    ).toBeNull()
  })

  it('matches dot-separated asset names to space/underscore tags', () => {
    const assets = [
      ...baseAssets,
      {
        id: '7',
        file_name: 'yu_ha_min_paizuri.hard.webp',
        storage_path: 'user/yu_ha_min_paizuri.hard.webp',
        display_name: null,
        metadata: { aliases: ['Yu Ha-min_paizuri.hard'] },
      },
    ]
    const result = resolveAssetTag('<img="Yu Ha-min_paizuri hard">', {
      assets,
      storageBaseUrl: 'https://cdn.supabase.co',
    })

    expect(result).toMatchObject({
      asset: expect.objectContaining({ id: '7' }),
      strategy: 'normalized',
    })
  })

  it('uses the injected asset URL resolver when provided', () => {
    const result = resolveAssetTag('Smile', {
      ...context,
      getAssetUrl: (asset) => `https://signed.test/${asset.storage_path}?token=abc`,
    })

    expect(result?.url).toBe('https://signed.test/user/Smile.webp?token=abc')
  })
})

describe('buildAssetUrlMap / resolveAssetUrl', () => {
  it('registers aliases, normalized keys, and base filenames', () => {
    const urlMap = buildAssetUrlMap(baseAssets, {
      getAssetUrl: (path) => `https://public/${path}`,
    })

    expect(urlMap['Smile.webp']).toBe('https://public/user/Smile.webp')
    expect(urlMap['smile.webp']).toBe('https://public/user/Smile.webp') // normalized
    expect(urlMap['Smile']).toBe('https://public/user/Smile.webp') // alias
    expect(urlMap['smile']).toBe('https://public/user/Smile.webp')
    expect(urlMap['Snow Rim.sad']).toBe('https://public/user/snow_rim_sad.webp')

    // Base filename lookup with normalization
    expect(urlMap['pose.png']).toBe('https://public/user/pose.png')
    expect(urlMap['pose']).toBe('https://public/user/pose.png')
  })

  it('resolves using normalized keys, base filename, and extension fallback', () => {
    const urlMap = buildAssetUrlMap(baseAssets, {
      getAssetUrl: (path) => `https://public/${path}`,
    })

    // Normalized alias
    expect(resolveAssetUrl('snow rim sad', urlMap)).toBe('https://public/user/snow_rim_sad.webp')
    // Base filename
    expect(resolveAssetUrl('user/snow_rim_sad.webp', urlMap)).toBe(
      'https://public/user/snow_rim_sad.webp',
    )
    // Extension fallback
    expect(resolveAssetUrl('mood_1', urlMap)).toBe('https://public/user/mood_1.png')
  })

  it('resolves dot-separated asset names from space-separated tags', () => {
    const assets = [
      ...baseAssets,
      {
        id: '7',
        file_name: 'yu_ha_min_paizuri.hard.webp',
        storage_path: 'user/yu_ha_min_paizuri.hard.webp',
        display_name: null,
        metadata: { aliases: ['Yu Ha-min_paizuri.hard'] },
      },
    ]
    const urlMap = buildAssetUrlMap(assets, {
      getAssetUrl: (path) => `https://public/${path}`,
    })

    expect(resolveAssetUrl('Yu Ha-min_paizuri hard', urlMap)).toBe(
      'https://public/user/yu_ha_min_paizuri.hard.webp',
    )
  })
})

describe('extractAssetTags', () => {
  it('extracts tags from canonical markdown, legacy templates, emoji, and html wrappers', () => {
    const tags = extractAssetTags(
      'Use ![hero](asset:Smile) and [ 🖼 | Smile ] and {{img::sad}} plus {{image::pose}} plus <img="pose">',
    )

    expect(tags).toEqual(expect.arrayContaining(['Smile', 'sad', 'pose']))
  })

  it('extracts tags from standard HTML img src format', () => {
    const tags = extractAssetTags(
      'Display <img src="school_worried"> and <img src="outdoor_smile"/>',
    )

    expect(tags).toEqual(expect.arrayContaining(['school_worried', 'outdoor_smile']))
  })
})

describe('resolveAssetTag with img src format', () => {
  it('resolves asset from standard HTML img src tag', () => {
    const result = resolveAssetTag('<img src="Smile">', context)

    expect(result).toMatchObject({
      asset: expect.objectContaining({ id: '1' }),
      strategy: 'exact',
    })
  })

  it('resolves asset from self-closing img src tag', () => {
    const result = resolveAssetTag('<img src="pose"/>', context)

    expect(result).toMatchObject({
      asset: expect.objectContaining({ id: '5' }),
    })
  })
})

describe('fuzzy matching (underscore-ignoring)', () => {
  it('resolves asset when tag has fewer underscores than filename', () => {
    // CharX file issue: asset name has "lifting_skirt" but document uses "liftingskirt"
    const assets = [
      {
        id: 'fuzzy-1',
        file_name: '16.png',
        storage_path: 'user/16.png',
        display_name: 'shion_basic_lifting_skirt.png',
        metadata: null,
      },
    ]
    const urlMap = buildAssetUrlMap(assets, {
      getAssetUrl: (path) => `https://public/${path}`,
    })

    // Tag without underscore should match filename with underscore
    expect(resolveAssetUrl('shion_basic_liftingskirt', urlMap)).toBe('https://public/user/16.png')
  })

  it('resolves asset when tag has more underscores than filename', () => {
    const assets = [
      {
        id: 'fuzzy-2',
        file_name: 'char_happysmile.webp',
        storage_path: 'user/char_happysmile.webp',
        display_name: 'char_happysmile',
        metadata: null,
      },
    ]
    const urlMap = buildAssetUrlMap(assets, {
      getAssetUrl: (path) => `https://public/${path}`,
    })

    // Tag with extra underscore should match filename without it
    expect(resolveAssetUrl('char_happy_smile', urlMap)).toBe(
      'https://public/user/char_happysmile.webp',
    )
  })

  it('resolves asset when LLM wraps name in parentheses', () => {
    // LLM outputs <img src=(breast grab)> — parentheses stripped by fuzzy normalization
    const assets = [
      {
        id: 'fuzzy-paren',
        file_name: 'breast_grab.webp',
        storage_path: 'user/breast_grab.webp',
        display_name: 'breast_grab',
        metadata: { aliases: ['breast_grab'] },
      },
    ]
    const urlMap = buildAssetUrlMap(assets, {
      getAssetUrl: (path) => `https://public/${path}`,
    })

    expect(resolveAssetUrl('(breast grab)', urlMap)).toBe('https://public/user/breast_grab.webp')
    expect(resolveAssetUrl('[breast grab]', urlMap)).toBe('https://public/user/breast_grab.webp')
    expect(resolveAssetUrl('{breast grab}', urlMap)).toBe('https://public/user/breast_grab.webp')
  })

  it('resolves asset via fuzzy match with extension fallback', () => {
    const assets = [
      {
        id: 'fuzzy-3',
        file_name: 'emotion_crying_hard.png',
        storage_path: 'user/emotion_crying_hard.png',
        display_name: 'emotion_crying_hard.png',
        metadata: null,
      },
    ]
    const urlMap = buildAssetUrlMap(assets, {
      getAssetUrl: (path) => `https://public/${path}`,
    })

    // Tag without extension and with collapsed underscores
    expect(resolveAssetUrl('emotion_cryinghard', urlMap)).toBe(
      'https://public/user/emotion_crying_hard.png',
    )
  })
})
