import { describe, expect, it } from 'vitest'

import {
  LEGACY_ASSET_URL_COMPATIBILITY_SUPPORT,
  registerLegacyCompatibleAssetUrlKeys,
  resolveLegacyCompatibleAssetUrl,
} from './asset-url-map-legacy-compat'

describe('registerLegacyCompatibleAssetUrlKeys', () => {
  it('is explicitly marked as a removal-candidate compatibility layer', () => {
    expect(LEGACY_ASSET_URL_COMPATIBILITY_SUPPORT.tier).toBe('removal')
  })

  it('registers fuzzy keys for legacy imported asset names', () => {
    const urlMap: Record<string, string> = {}

    registerLegacyCompatibleAssetUrlKeys(
      urlMap,
      'shion_basic_lifting_skirt.png',
      'https://public/user/16.png',
    )

    expect(urlMap['shionbasicliftingskirt.png']).toBe('https://public/user/16.png')
  })
})

describe('resolveLegacyCompatibleAssetUrl', () => {
  it('resolves fuzzy underscore drift from legacy imports', () => {
    const urlMap = {
      shionbasicliftingskirt: 'https://public/user/16.png',
    }

    expect(resolveLegacyCompatibleAssetUrl('shion_basic_liftingskirt', urlMap)).toBe(
      'https://public/user/16.png',
    )
  })

  it('resolves extension-less legacy references against stored image filenames', () => {
    const urlMap = {
      'emotion_crying_hard.png': 'https://public/user/emotion_crying_hard.png',
      'emotioncryinghard.png': 'https://public/user/emotion_crying_hard.png',
    }

    expect(resolveLegacyCompatibleAssetUrl('emotion_cryinghard', urlMap)).toBe(
      'https://public/user/emotion_crying_hard.png',
    )
  })
})
