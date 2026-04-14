import { describe, expect, it } from 'vitest'

import {
  EMPTY_ASSET_DATA,
  normalizeChatAssetData,
  resolveNextRuntimeVariables,
} from './useChatRuntimeVariables'

describe('normalizeChatAssetData', () => {
  it('returns empty defaults for invalid payloads', () => {
    expect(normalizeChatAssetData(null)).toEqual(EMPTY_ASSET_DATA)
    expect(normalizeChatAssetData('bad')).toEqual(EMPTY_ASSET_DATA)
  })

  it('sanitizes assets, maps, and module metadata from route payloads', () => {
    expect(
      normalizeChatAssetData({
        characterAssets: [
          {
            id: 'asset-1',
            file_name: 'hero.png',
            storage_path: 'user/hero.png',
            display_name: 'Hero',
            metadata: { aliases: ['hero'] },
          },
          { id: 'broken' },
        ],
        assetUrlMap: { hero: 'https://example.test/hero.png', bad: 123 },
        imageCommandUrlMap: { smile: 'https://example.test/smile.png' },
        moduleRegex: [
          {
            type: 'editinput',
            comment: 'replace',
            in: 'a',
            out: 'b',
            ableFlag: true,
            bindings: { capture: 'value', ignored: 1 },
          },
          { type: 'broken' },
        ],
        moduleAssetSummary: [
          {
            moduleId: 'module-1',
            moduleName: 'Module One',
            assetCount: 2,
            expectedAssetCount: 3,
          },
          {
            moduleName: 'Broken',
          },
        ],
        globalVariables: { mood: 'happy', nested: { okay: true } },
      }),
    ).toEqual({
      characterAssets: [
        {
          id: 'asset-1',
          file_name: 'hero.png',
          storage_path: 'user/hero.png',
          display_name: 'Hero',
          canonical_name: null,
          display_order: null,
          metadata: { aliases: ['hero'] },
        },
      ],
      assetUrlMap: { hero: 'https://example.test/hero.png' },
      imageCommandUrlMap: { smile: 'https://example.test/smile.png' },
      moduleRegex: [
        {
          type: 'editinput',
          comment: 'replace',
          in: 'a',
          out: 'b',
          ableFlag: true,
          bindings: { capture: 'value' },
        },
      ],
      moduleAssetSummary: [
        {
          moduleId: 'module-1',
          moduleName: 'Module One',
          assetCount: 2,
          expectedAssetCount: 3,
        },
      ],
      globalVariables: { mood: 'happy', nested: { okay: true } },
    })
  })
})

describe('resolveNextRuntimeVariables', () => {
  it('applies toggle payload values directly', () => {
    expect(
      resolveNextRuntimeVariables({ brave: false }, 'toggle', 'brave', {
        value: true,
      }),
    ).toEqual({ brave: true })
  })

  it('treats button actions as boolean activations', () => {
    expect(resolveNextRuntimeVariables({}, 'button', 'wave')).toEqual({ wave: true })
  })

  it('ignores empty action ids', () => {
    const current = { existing: 1 }
    expect(resolveNextRuntimeVariables(current, 'button', '   ')).toBe(current)
  })
})
