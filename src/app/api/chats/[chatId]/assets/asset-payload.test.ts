import { describe, expect, it } from 'vitest'

import { buildChatAssetPayload, reduceGlobalVariables } from './asset-payload'
import type { CharacterAssetRecord } from './asset-queries'

function createAsset(overrides: Partial<CharacterAssetRecord>): CharacterAssetRecord {
  return {
    id: 'asset-1',
    file_name: 'hero_happy.webp',
    storage_path: 'char-1/hero_happy.webp',
    display_name: 'Hero Happy',
    canonical_name: 'hero very happy.webp',
    display_order: 1,
    metadata: null,
    ...overrides,
  }
}

describe('reduceGlobalVariables', () => {
  it('keeps only keyed entries', () => {
    expect(
      reduceGlobalVariables([
        { key: 'scene', value: 'beach' },
        { key: '', value: 'ignored' },
      ]),
    ).toEqual({ scene: 'beach' })
  })
})

describe('buildChatAssetPayload', () => {
  it('adds short aliases, merges module assets, and maps image commands', () => {
    const body = buildChatAssetPayload({
      characterAssets: [
        createAsset({
          id: 'asset-1',
          file_name: 'hero_happy.webp',
          storage_path: 'char-1/hero_happy.webp',
          canonical_name: 'hero very happy.webp',
        }),
        createAsset({
          id: 'asset-2',
          file_name: 'hero_relaxed.webp',
          storage_path: 'char-1/hero_relaxed.webp',
          canonical_name: 'hero softly smiling.webp',
          display_order: 2,
        }),
      ],
      characterAssetUrlMapByPath: {
        'char-1/hero_happy.webp': 'https://cdn.test/character-assets/char-1/hero_happy.webp',
        'char-1/hero_relaxed.webp': 'https://cdn.test/character-assets/char-1/hero_relaxed.webp',
      },
      characterMetadata: {
        image_commands: {
          happy: 'asset-1',
        },
        character_list: 'Happy Face, Relaxed Face',
      },
      moduleAssetUrls: {
        module_badge: 'https://cdn.test/module-assets/module_badge.webp',
      },
      moduleRegex: [],
      moduleAssetSummary: [],
      globalVariables: {
        scene: 'beach',
      },
    })

    expect(body.assetUrlMap.module_badge).toBe('https://cdn.test/module-assets/module_badge.webp')
    expect(body.assetUrlMap['hero_happy.webp']).toBe(
      'https://cdn.test/character-assets/char-1/hero_happy.webp',
    )
    expect(body.imageCommandUrlMap).toMatchObject({
      happy: 'https://cdn.test/character-assets/char-1/hero_happy.webp',
      happy_face: 'https://cdn.test/character-assets/char-1/hero_happy.webp',
      relaxed_face: 'https://cdn.test/character-assets/char-1/hero_relaxed.webp',
      module_badge: 'https://cdn.test/module-assets/module_badge.webp',
    })
    expect(body.globalVariables).toEqual({ scene: 'beach' })
  })

  it('keeps character commands and asset aliases ahead of colliding module keys', () => {
    const hostUrl = 'https://cdn.test/character-assets/host.webp'
    const body = buildChatAssetPayload({
      characterAssets: [createAsset({ metadata: { aliases: ['host_pose'] } })],
      characterAssetUrlMapByPath: { 'char-1/hero_happy.webp': hostUrl },
      characterMetadata: { image_commands: { happy: 'asset-1' } },
      moduleAssetUrls: {
        happy: 'https://cdn.test/module-assets/happy.webp',
        host_pose: 'https://cdn.test/module-assets/host-pose.webp',
        'HOST POSE': 'https://cdn.test/module-assets/normalized-host-pose.webp',
        companion: 'https://cdn.test/module-assets/companion.webp',
      },
      moduleRegex: [],
      moduleAssetSummary: [],
      globalVariables: {},
    })

    expect(body.imageCommandUrlMap.happy).toBe(hostUrl)
    expect(body.imageCommandUrlMap).not.toHaveProperty('host_pose')
    expect(body.imageCommandUrlMap).not.toHaveProperty('HOST POSE')
    expect(body.assetUrlMap.host_pose).toBe(hostUrl)
    expect(body.imageCommandUrlMap.companion).toBe('https://cdn.test/module-assets/companion.webp')
  })

  it('prefers an uppercase canonical name when normalized duplicates collide', () => {
    const body = buildChatAssetPayload({
      characterAssets: [
        createAsset({
          id: 'asset-1',
          file_name: 'hero-happy-lower.webp',
          storage_path: 'char-1/hero-happy-lower.webp',
          canonical_name: 'hero very happy.webp',
        }),
        createAsset({
          id: 'asset-2',
          file_name: 'hero-happy-upper.webp',
          storage_path: 'char-1/hero-happy-upper.webp',
          canonical_name: 'Hero Very Happy.webp',
          display_order: 2,
        }),
      ],
      characterAssetUrlMapByPath: {
        'char-1/hero-happy-lower.webp':
          'https://cdn.test/character-assets/char-1/hero-happy-lower.webp',
        'char-1/hero-happy-upper.webp':
          'https://cdn.test/character-assets/char-1/hero-happy-upper.webp',
      },
      characterMetadata: null,
      moduleAssetUrls: {},
      moduleRegex: [],
      moduleAssetSummary: [],
      globalVariables: {},
    })

    expect(body.assetUrlMap['hero_happy.webp']).toBe(
      'https://cdn.test/character-assets/char-1/hero-happy-lower.webp',
    )
  })
})
