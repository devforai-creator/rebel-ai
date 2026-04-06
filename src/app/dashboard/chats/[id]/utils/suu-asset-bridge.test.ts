import { describe, expect, it, vi } from 'vitest'
import { buildSuuAssetMap } from './suu-asset-bridge'

// Mock resolveAssetUrl to test bridge logic independently
vi.mock('@/lib/asset-resolver', () => ({
  resolveAssetUrl: (name: string, map: Record<string, string>) => {
    // Simulate basic exact match + case-insensitive fallback
    if (name in map) return map[name]
    const lower = name.toLowerCase()
    for (const [key, url] of Object.entries(map)) {
      if (key.toLowerCase() === lower) return url
    }
    return undefined
  },
}))

describe('buildSuuAssetMap', () => {
  const assetUrlMap: Record<string, string> = {
    'portrait.png': 'https://storage.example.com/portrait.png',
    'background.webp': 'https://storage.example.com/background.webp',
    'icon.webp': 'https://storage.example.com/icon.webp',
  }

  it('registers both @assets/ full path and bare filename as keys', () => {
    const uiCardAssets = {
      portrait: '@assets/portrait.png',
      bg: '@assets/background.webp',
    }
    const result = buildSuuAssetMap(uiCardAssets, assetUrlMap)
    // SUU's resolveAsset() looks up by @assets/... then stripped filename
    expect(result).toEqual({
      '@assets/portrait.png': 'https://storage.example.com/portrait.png',
      'portrait.png': 'https://storage.example.com/portrait.png',
      '@assets/background.webp': 'https://storage.example.com/background.webp',
      'background.webp': 'https://storage.example.com/background.webp',
    })
  })

  it('adds @assets/ prefix for bare filenames', () => {
    const uiCardAssets = { icon: 'icon.webp' }
    const result = buildSuuAssetMap(uiCardAssets, assetUrlMap)
    expect(result).toEqual({
      '@assets/icon.webp': 'https://storage.example.com/icon.webp',
      'icon.webp': 'https://storage.example.com/icon.webp',
    })
  })

  it('returns empty object for null uiCardAssets', () => {
    expect(buildSuuAssetMap(null, assetUrlMap)).toEqual({})
  })

  it('returns empty object for undefined uiCardAssets', () => {
    expect(buildSuuAssetMap(undefined, assetUrlMap)).toEqual({})
  })

  it('omits assets that cannot be resolved', () => {
    const uiCardAssets = {
      portrait: '@assets/portrait.png',
      missing: '@assets/nonexistent.png',
    }
    const result = buildSuuAssetMap(uiCardAssets, assetUrlMap)
    expect(result['@assets/portrait.png']).toBe('https://storage.example.com/portrait.png')
    expect(result['portrait.png']).toBe('https://storage.example.com/portrait.png')
    expect(result['@assets/nonexistent.png']).toBeUndefined()
    expect(result['nonexistent.png']).toBeUndefined()
  })

  it('handles case-insensitive filename resolution', () => {
    const uiCardAssets = { avatar: '@assets/Portrait.PNG' }
    const result = buildSuuAssetMap(uiCardAssets, assetUrlMap)
    // Mock resolves case-insensitively; keys use original casing from input
    expect(result['@assets/Portrait.PNG']).toBe('https://storage.example.com/portrait.png')
    expect(result['Portrait.PNG']).toBe('https://storage.example.com/portrait.png')
  })

  it('skips non-string values in uiCardAssets', () => {
    const uiCardAssets = {
      portrait: '@assets/portrait.png',
      broken: 123 as unknown as string,
      alsobroken: null as unknown as string,
    }
    const result = buildSuuAssetMap(uiCardAssets, assetUrlMap)
    expect(Object.keys(result)).toHaveLength(2) // @assets/portrait.png + portrait.png
    expect(result['@assets/portrait.png']).toBe('https://storage.example.com/portrait.png')
  })

  it('returns empty object for empty uiCardAssets', () => {
    expect(buildSuuAssetMap({}, assetUrlMap)).toEqual({})
  })

  it('returns empty object for empty assetUrlMap', () => {
    const uiCardAssets = { portrait: '@assets/portrait.png' }
    expect(buildSuuAssetMap(uiCardAssets, {})).toEqual({})
  })
})
