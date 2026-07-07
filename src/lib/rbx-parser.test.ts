import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { parseRbxArchive, isRbxArchive } from './rbx-parser'

// ============================================================================
// Helpers
// ============================================================================

/** Build a minimal valid manifest.json */
function buildManifest(overrides?: Record<string, unknown>) {
  return {
    format: 'rbx',
    version: '1.0',
    character: {
      name: 'Test Character',
      system_prompt: 'You are a test character.',
    },
    ...overrides,
  }
}

/** Build a ZIP ArrayBuffer with manifest.json and optional asset files */
async function buildRbxZip(
  manifest: unknown,
  assets?: Record<string, Uint8Array>,
  moduleAssets?: Record<string, Uint8Array>,
): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest))

  if (assets) {
    for (const [name, data] of Object.entries(assets)) {
      zip.file(`assets/${name}`, data)
    }
  }

  if (moduleAssets) {
    for (const [path, data] of Object.entries(moduleAssets)) {
      zip.file(`module_assets/${path}`, data)
    }
  }

  return zip.generateAsync({ type: 'arraybuffer' })
}

async function buildCompressedRbxZip(
  manifest: unknown,
  assets?: Record<string, Uint8Array>,
): Promise<ArrayBuffer> {
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest))

  if (assets) {
    for (const [name, data] of Object.entries(assets)) {
      zip.file(`assets/${name}`, data)
    }
  }

  return zip.generateAsync({
    type: 'arraybuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  })
}

function forgeZipDeclaredUncompressedSize(
  buffer: ArrayBuffer,
  fileName: string,
  declaredSize: number,
): ArrayBuffer {
  const bytes = new Uint8Array(buffer.slice(0))
  const view = new DataView(bytes.buffer)
  const fileNameBytes = new TextEncoder().encode(fileName)

  for (let offset = 0; offset <= bytes.length - 4; offset++) {
    const signature = view.getUint32(offset, true)

    if (signature === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true)
      const extraLength = view.getUint16(offset + 28, true)
      const nameOffset = offset + 30
      if (matchesBytes(bytes, nameOffset, fileNameBytes)) {
        view.setUint32(offset + 22, declaredSize, true)
      }
      offset = nameOffset + nameLength + extraLength - 1
      continue
    }

    if (signature === 0x02014b50) {
      const nameLength = view.getUint16(offset + 28, true)
      const extraLength = view.getUint16(offset + 30, true)
      const commentLength = view.getUint16(offset + 32, true)
      const nameOffset = offset + 46
      if (matchesBytes(bytes, nameOffset, fileNameBytes)) {
        view.setUint32(offset + 24, declaredSize, true)
      }
      offset = nameOffset + nameLength + extraLength + commentLength - 1
    }
  }

  return bytes.buffer
}

function matchesBytes(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
  if (offset + expected.length > bytes.length) return false

  for (let i = 0; i < expected.length; i++) {
    if (bytes[offset + i] !== expected[i]) return false
  }

  return true
}

const TINY_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) // 8-byte PNG header (not a real image, but enough for parsing)

// ============================================================================
// isRbxArchive
// ============================================================================

describe('isRbxArchive', () => {
  it('returns true for a ZIP with manifest.json format: "rbx"', async () => {
    const buffer = await buildRbxZip(buildManifest())
    expect(await isRbxArchive(buffer)).toBe(true)
  })

  it('returns false for a ZIP without manifest.json', async () => {
    const zip = new JSZip()
    zip.file('card.json', '{}')
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    expect(await isRbxArchive(buffer)).toBe(false)
  })

  it('returns false for a ZIP with wrong format field', async () => {
    const buffer = await buildRbxZip({ format: 'charx', version: '3.0' })
    expect(await isRbxArchive(buffer)).toBe(false)
  })

  it('returns false for non-ZIP data', async () => {
    expect(await isRbxArchive(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBe(false)
  })
})

// ============================================================================
// parseRbxArchive — valid manifests
// ============================================================================

describe('parseRbxArchive', () => {
  it('parses a minimal manifest with no assets', async () => {
    const buffer = await buildRbxZip(buildManifest())
    const result = await parseRbxArchive(buffer)

    expect(result.manifest.format).toBe('rbx')
    expect(result.manifest.version).toBe('1.0')
    expect(result.manifest.character.name).toBe('Test Character')
    expect(result.manifest.character.system_prompt).toBe('You are a test character.')
    expect(result.characterAssets).toHaveLength(0)
    expect(result.moduleAssets.size).toBe(0)
    expect(result.missingAssets).toHaveLength(0)
  })

  it('applies defaults for optional fields', async () => {
    const buffer = await buildRbxZip(buildManifest())
    const result = await parseRbxArchive(buffer)
    const char = result.manifest.character

    expect(char.description).toBeNull()
    expect(char.greeting_message).toBeNull()
    expect(char.visibility).toBe('private')
    expect(char.metadata.type).toBe('character')
    expect(char.metadata.alternate_greetings).toEqual([])
    expect(char.metadata.image_commands).toEqual({})
    expect(char.metadata.ui_card).toBeNull()
  })

  it('parses character assets from ZIP', async () => {
    const manifest = buildManifest({
      assets: [
        { file_name: 'icon.png', asset_type: 'icon' },
        { file_name: 'npc.webp', asset_type: 'character_image' },
      ],
    })
    const buffer = await buildRbxZip(manifest, {
      'icon.png': TINY_PNG,
      'npc.webp': new Uint8Array([0x52, 0x49, 0x46, 0x46]),
    })

    const result = await parseRbxArchive(buffer)
    expect(result.characterAssets).toHaveLength(2)
    expect(result.characterAssets.map((a) => a.fileName).sort()).toEqual(['icon.png', 'npc.webp'])
    expect(result.missingAssets).toHaveLength(0)
  })

  it('detects missing assets referenced in manifest but absent from ZIP', async () => {
    const manifest = buildManifest({
      assets: [
        { file_name: 'icon.png', asset_type: 'icon' },
        { file_name: 'missing.webp', asset_type: 'character_image' },
      ],
    })
    const buffer = await buildRbxZip(manifest, {
      'icon.png': TINY_PNG,
      // missing.webp not included
    })

    const result = await parseRbxArchive(buffer)
    expect(result.characterAssets).toHaveLength(1)
    expect(result.missingAssets).toContain('assets/missing.webp')
  })

  it('parses module assets from module_assets/{i}/', async () => {
    const manifest = buildManifest({
      modules: [
        {
          enabled: true,
          priority: 0,
          module: {
            name: 'Test Module',
            assets: [{ file_name: 'bg.png' }],
          },
        },
      ],
    })
    const buffer = await buildRbxZip(manifest, {}, { '0/bg.png': TINY_PNG })

    const result = await parseRbxArchive(buffer)
    expect(result.moduleAssets.get(0)).toHaveLength(1)
    expect(result.moduleAssets.get(0)![0].fileName).toBe('bg.png')
    expect(result.missingAssets).toHaveLength(0)
  })

  it('detects missing module assets', async () => {
    const manifest = buildManifest({
      modules: [
        {
          enabled: true,
          priority: 0,
          module: {
            name: 'Test Module',
            assets: [{ file_name: 'missing.png' }],
          },
        },
      ],
    })
    const buffer = await buildRbxZip(manifest, {}, {})

    const result = await parseRbxArchive(buffer)
    expect(result.missingAssets).toContain('module_assets/0/missing.png')
  })

  it('parses modules with lorebook and extract regex', async () => {
    const manifest = buildManifest({
      modules: [
        {
          enabled: true,
          priority: 5,
          module: {
            name: 'Story Module',
            lorebook: [{ key: 'magic,spell', content: 'Magic system description' }],
            regex: [
              {
                in: '\\[HP:(\\d+)/(\\d+)\\]',
                out: '',
                type: 'extract',
                bindings: { hp: '$1', maxHp: '$2' },
                card_ref: 'status',
              },
            ],
          },
        },
      ],
    })
    const buffer = await buildRbxZip(manifest)
    const result = await parseRbxArchive(buffer)

    expect(result.manifest.modules).toHaveLength(1)
    expect(result.manifest.modules[0].enabled).toBe(true)
    expect(result.manifest.modules[0].priority).toBe(5)
    expect(result.manifest.modules[0].module.lorebook).toHaveLength(1)
    expect(result.manifest.modules[0].module.regex).toHaveLength(1)
    expect(result.manifest.modules[0].module.regex[0].type).toBe('extract')
    expect(result.manifest.modules[0].module.regex[0].bindings).toEqual({
      hp: '$1',
      maxHp: '$2',
    })
    expect(result.manifest.modules[0].module.regex[0].card_ref).toBe('status')
  })

  it('parses ui_card in character metadata', async () => {
    const uiCard = {
      meta: { name: 'test-card', version: '1.0.0' },
      state: { hp: 100 },
      views: {
        Main: {
          type: 'Column',
          children: [{ type: 'ProgressBar', value: { $ref: '$hp' }, max: 100, color: '#00ff88' }],
        },
      },
    }
    const manifest = buildManifest({
      character: {
        name: 'UI Card Test',
        system_prompt: 'Test',
        metadata: { ui_card: uiCard },
      },
    })
    const buffer = await buildRbxZip(manifest)
    const result = await parseRbxArchive(buffer)

    expect(result.manifest.character.metadata.ui_card).toEqual(uiCard)
  })

  it('parses ui_cards registry in character metadata', async () => {
    const uiCards = {
      archive: {
        meta: { name: 'archive-card', version: '1.0.0' },
        views: { Main: { type: 'Column', children: [] } },
      },
      invention: {
        meta: { name: 'invention-card', version: '1.0.0' },
        views: { Main: { type: 'Column', children: [] } },
      },
    }

    const manifest = buildManifest({
      character: {
        name: 'UI Card Registry Test',
        system_prompt: 'Test',
        metadata: { ui_cards: uiCards },
      },
    })
    const buffer = await buildRbxZip(manifest)
    const result = await parseRbxArchive(buffer)

    expect(result.manifest.character.metadata.ui_cards).toEqual(uiCards)
  })
})

// ============================================================================
// parseRbxArchive — validation errors
// ============================================================================

describe('parseRbxArchive validation', () => {
  it('throws on non-ZIP data', async () => {
    await expect(parseRbxArchive(new Uint8Array([0x00, 0x01]))).rejects.toThrow('not a valid ZIP')
  })

  it('throws when manifest.json is missing', async () => {
    const zip = new JSZip()
    zip.file('card.json', '{}')
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(parseRbxArchive(buffer)).rejects.toThrow('manifest.json not found')
  })

  it('throws on invalid JSON in manifest', async () => {
    const zip = new JSZip()
    zip.file('manifest.json', '{broken json')
    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    await expect(parseRbxArchive(buffer)).rejects.toThrow('invalid JSON')
  })

  it('throws when format is not "rbx"', async () => {
    const buffer = await buildRbxZip({
      format: 'charx',
      version: '3.0',
      character: { name: 'x', system_prompt: 'y' },
    })
    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('throws when required character.name is missing', async () => {
    const buffer = await buildRbxZip({
      format: 'rbx',
      version: '1.0',
      character: { system_prompt: 'y' },
    })
    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('throws when required character.system_prompt is missing', async () => {
    const buffer = await buildRbxZip({ format: 'rbx', version: '1.0', character: { name: 'x' } })
    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('rejects deprecated editdisplay regex type', async () => {
    const manifest = buildManifest({
      modules: [
        {
          module: {
            name: 'Legacy',
            regex: [{ in: 'test', out: '<div>html</div>', type: 'editdisplay' }],
          },
        },
      ],
    })
    const buffer = await buildRbxZip(manifest)

    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('rejects populated triggers', async () => {
    const manifest = buildManifest({
      modules: [
        {
          module: {
            name: 'Legacy',
            triggers: [{ type: 'manual', comment: 'test', effect: [] }],
          } as Record<string, unknown>,
        },
      ],
    })
    const buffer = await buildRbxZip(manifest)

    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('rejects populated toggle_definitions', async () => {
    const manifest = buildManifest({
      modules: [
        {
          module: {
            name: 'Legacy',
            toggle_definitions: { mode: { label: 'Mode', type: 'boolean', value: true } },
          } as Record<string, unknown>,
        },
      ],
    })
    const buffer = await buildRbxZip(manifest)

    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('rejects populated background_html', async () => {
    const manifest = buildManifest({
      character: {
        name: 'Legacy Character',
        system_prompt: 'Test',
        metadata: {
          background_html: '<div>legacy panel</div>',
        },
      },
    })
    const buffer = await buildRbxZip(manifest)

    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('rejects populated emotion_images', async () => {
    const manifest = buildManifest({
      character: {
        name: 'Legacy Character',
        system_prompt: 'Test',
        metadata: {
          emotion_images: {
            happy: 'happy.png',
          },
        },
      },
    })
    const buffer = await buildRbxZip(manifest)

    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('rejects invalid asset_type', async () => {
    const manifest = buildManifest({
      assets: [{ file_name: 'x.png', asset_type: 'emotion' }],
    })
    const buffer = await buildRbxZip(manifest)
    await expect(parseRbxArchive(buffer)).rejects.toThrow('Invalid .rbx manifest')
  })

  it('supports trusted callers overriding the asset-count limit', async () => {
    const manifest = buildManifest({
      assets: [
        { file_name: 'a.png', asset_type: 'icon' },
        { file_name: 'b.png', asset_type: 'character_image' },
        { file_name: 'c.png', asset_type: 'background' },
      ],
    })
    const buffer = await buildRbxZip(manifest, {
      'a.png': TINY_PNG,
      'b.png': TINY_PNG,
      'c.png': TINY_PNG,
    })

    await expect(parseRbxArchive(buffer, { maxAssetCount: 2 })).rejects.toThrow(
      'Archive contains more than 2 assets',
    )

    const result = await parseRbxArchive(buffer, { maxAssetCount: 4 })
    expect(result.characterAssets).toHaveLength(3)
  })

  it('supports trusted callers overriding the decompressed-size limit', async () => {
    const mediumAsset = new Uint8Array(2_048)
    const manifest = buildManifest({
      assets: [{ file_name: 'large.png', asset_type: 'background' }],
    })
    const buffer = await buildRbxZip(manifest, {
      'large.png': mediumAsset,
    })

    await expect(parseRbxArchive(buffer, { maxDecompressedMb: 0.001 })).rejects.toThrow(
      'Total decompressed size exceeds 0.001MB limit',
    )

    const result = await parseRbxArchive(buffer, { maxDecompressedMb: 1 })
    expect(result.characterAssets).toHaveLength(1)
  })

  it('enforces the decompressed-size limit even when ZIP headers underreport asset size', async () => {
    const compressibleAsset = new Uint8Array(2_048)
    const manifest = buildManifest({
      assets: [{ file_name: 'bomb.png', asset_type: 'background' }],
    })
    const buffer = await buildCompressedRbxZip(manifest, {
      'bomb.png': compressibleAsset,
    })
    const forgedBuffer = forgeZipDeclaredUncompressedSize(buffer, 'assets/bomb.png', 1)

    await expect(parseRbxArchive(forgedBuffer, { maxDecompressedMb: 0.001 })).rejects.toThrow(
      'Total decompressed size exceeds 0.001MB limit',
    )
  })

  it('enforces the manifest-size limit even when ZIP headers underreport manifest size', async () => {
    const oversizedManifest = buildManifest({
      character: {
        name: 'Forged Manifest',
        system_prompt: 'x'.repeat(2_048),
      },
    })
    const buffer = await buildCompressedRbxZip(oversizedManifest)
    const forgedBuffer = forgeZipDeclaredUncompressedSize(buffer, 'manifest.json', 1)

    await expect(parseRbxArchive(forgedBuffer, { maxManifestBytes: 1024 })).rejects.toThrow(
      'manifest.json exceeds 0.001MB limit',
    )
  })

  it('rejects assets whose declared uncompressed size exceeds the per-asset limit', async () => {
    const manifest = buildManifest({
      assets: [{ file_name: 'huge.png', asset_type: 'background' }],
    })
    const buffer = await buildRbxZip(manifest, {
      'huge.png': TINY_PNG,
    })
    const forgedBuffer = forgeZipDeclaredUncompressedSize(
      buffer,
      'assets/huge.png',
      21 * 1024 * 1024,
    )

    await expect(parseRbxArchive(forgedBuffer)).rejects.toThrow('exceeds 20MB per-asset limit')
  })

  it('supports trusted callers overriding the manifest-size limit', async () => {
    const oversizedManifest = buildManifest({
      character: {
        name: 'Large Manifest',
        system_prompt: 'x'.repeat(1_100_000),
      },
    })
    const buffer = await buildRbxZip(oversizedManifest)

    await expect(parseRbxArchive(buffer)).rejects.toThrow('manifest.json exceeds 1MB limit')

    const result = await parseRbxArchive(buffer, { maxManifestBytes: 2 * 1024 * 1024 })
    expect(result.manifest.character.name).toBe('Large Manifest')
  })
})
