import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGreetingPreviewData } from './greeting-preview-data'

const { admin, fetchAssets, fetchModules, signAssets } = vi.hoisted(() => ({
  admin: {},
  fetchAssets: vi.fn(),
  fetchModules: vi.fn(),
  signAssets: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin }))
vi.mock('@/lib/assets/signed-asset-url', () => ({ createSignedAssetUrlMap: signAssets }))
vi.mock('@/app/api/chats/[chatId]/assets/asset-queries', () => ({
  fetchCharacterAssetsWithRetry: fetchAssets,
  fetchModuleData: fetchModules,
}))

beforeEach(() => {
  vi.clearAllMocks()
  fetchAssets.mockResolvedValue([
    {
      id: 'hero',
      file_name: 'hero.webp',
      storage_path: 'private/hero.webp',
      display_name: null,
      canonical_name: null,
      display_order: 0,
      metadata: {},
    },
  ])
  fetchModules.mockResolvedValue({
    allRegex: [{ type: 'extract', comment: '', in: 'status', out: '', ableFlag: true }],
    moduleAssetUrls: { 'scene.webp': 'https://example.com/signed-scene.webp' },
    moduleAssetSummary: [],
  })
  signAssets.mockResolvedValue({ 'private/hero.webp': 'https://example.com/signed-hero.webp' })
})

describe('loadGreetingPreviewData', () => {
  it('uses the chat asset pipeline for signed images, module extraction and image commands', async () => {
    const data = await loadGreetingPreviewData({
      id: 'character-1',
      metadata: { image_commands: { happy: 'hero' } },
    })

    expect(fetchAssets).toHaveBeenCalledWith(admin, 'character-1')
    expect(fetchModules).toHaveBeenCalledWith(admin, 'character-1')
    expect(signAssets).toHaveBeenCalledWith(admin, 'character-assets', ['private/hero.webp'])
    expect(data?.assetUrlMap['hero.webp']).toBe('https://example.com/signed-hero.webp')
    expect(data?.assetUrlMap['scene.webp']).toBe('https://example.com/signed-scene.webp')
    expect(data?.imageCommandUrlMap.happy).toBe('https://example.com/signed-hero.webp')
    expect(data?.moduleRegex[0].type).toBe('extract')
    expect(data?.globalVariables).toEqual({})
  })

  it('allows the page to fall back to readable text when preview loading fails', async () => {
    fetchModules.mockRejectedValueOnce(new Error('Unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await loadGreetingPreviewData({ id: 'character-1', metadata: {} })).toBeNull()
    } finally {
      log.mockRestore()
    }
  })
})
