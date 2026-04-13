import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importRbx } from './rbx-importer'
import type { RbxParseResult, RbxManifest, RbxAssetFile } from '@/types/rbx.types'

// ============================================================================
// Helpers
// ============================================================================

const TINY_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function createAssetFile(fileName: string, data?: Uint8Array): RbxAssetFile {
  return { fileName, data: data ?? TINY_PNG }
}

function createMinimalManifest(overrides?: Partial<RbxManifest>): RbxManifest {
  return {
    format: 'rbx' as const,
    version: '1.1',
    character: {
      name: 'Test Character',
      description: 'A test character',
      system_prompt: 'You are a test character.',
      greeting_message: 'Hello!',
      visibility: 'private',
      metadata: {
        type: 'character' as const,
        post_history_instructions: null,
        alternate_greetings: [],
        ui_card: null,
        ui_cards: {},
        background_html: null,
        default_variables: {},
        character_list: [],
        image_commands: {},
        image_display: null,
      },
      ...overrides?.character,
    },
    assets: overrides?.assets ?? [],
    modules: overrides?.modules ?? [],
  }
}

function createMinimalParseResult(overrides?: {
  manifest?: Partial<RbxManifest>
  characterAssets?: RbxAssetFile[]
  moduleAssets?: Map<number, RbxAssetFile[]>
  missingAssets?: string[]
}): RbxParseResult {
  return {
    manifest: createMinimalManifest(overrides?.manifest),
    characterAssets: overrides?.characterAssets ?? [],
    moduleAssets: overrides?.moduleAssets ?? new Map(),
    missingAssets: overrides?.missingAssets ?? [],
  }
}

function createMockSupabase(config?: {
  characterInsertError?: { message: string }
  characterUpdateError?: { message: string }
  characterDeleteError?: { message: string }
  assetInsertError?: { message: string }
  moduleInsertError?: { message: string }
  characterModuleLinkError?: { message: string }
  storageUploadError?: { message: string; status?: number; statusCode?: number }
  storageRemoveError?: { message: string }
  moduleAssetInsertError?: { message: string }
}) {
  const calls = {
    characterInserts: [] as Array<Record<string, unknown>>,
    characterUpdates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    characterDeletes: [] as string[],
    assetInserts: [] as Array<Record<string, unknown>>,
    moduleInserts: [] as Array<Record<string, unknown>>,
    characterModuleLinks: [] as Array<Record<string, unknown>>,
    moduleDeletes: [] as string[],
    storageUploads: [] as Array<{ bucket: string; path: string; data: unknown }>,
    storageRemovals: [] as Array<{ bucket: string; paths: string[] }>,
    moduleAssetInserts: [] as Array<Record<string, unknown>>,
  }

  const mockCharacterId = 'char-test-123'
  let moduleInsertCounter = 0
  let assetInsertCounter = 0

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'characters') {
        return {
          insert: vi.fn((data: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(() => {
                calls.characterInserts.push(data)
                if (config?.characterInsertError) {
                  return Promise.resolve({ data: null, error: config.characterInsertError })
                }
                return Promise.resolve({ data: { id: mockCharacterId }, error: null })
              }),
            })),
          })),
          update: vi.fn((data: Record<string, unknown>) => ({
            eq: vi.fn((_col: string, id: string) => {
              calls.characterUpdates.push({ id, data })
              if (config?.characterUpdateError) {
                return Promise.resolve({ error: config.characterUpdateError })
              }
              return Promise.resolve({ error: null })
            }),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn((_col: string, id: string) => {
              calls.characterDeletes.push(id)
              return Promise.resolve({ error: config?.characterDeleteError ?? null })
            }),
          })),
        }
      }
      if (table === 'character_assets') {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            calls.assetInserts.push(data)
            return {
              select: vi.fn(() => ({
                single: vi.fn(() => {
                  if (config?.assetInsertError) {
                    return Promise.resolve({ data: null, error: config.assetInsertError })
                  }
                  return Promise.resolve({
                    data: { id: `asset-${assetInsertCounter++}` },
                    error: null,
                  })
                }),
              })),
            }
          }),
        }
      }
      if (table === 'modules') {
        return {
          insert: vi.fn((data: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(() => {
                calls.moduleInserts.push(data)
                if (config?.moduleInsertError) {
                  return Promise.resolve({ data: null, error: config.moduleInsertError })
                }
                return Promise.resolve({
                  data: { id: `mod-test-${moduleInsertCounter++}` },
                  error: null,
                })
              }),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn((_col: string, id: string) => {
              calls.moduleDeletes.push(id)
              return Promise.resolve({ error: null })
            }),
          })),
        }
      }
      if (table === 'character_modules') {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            calls.characterModuleLinks.push(data)
            if (config?.characterModuleLinkError) {
              return Promise.resolve({ error: config.characterModuleLinkError })
            }
            return Promise.resolve({ error: null })
          }),
        }
      }
      if (table === 'module_assets') {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            calls.moduleAssetInserts.push(data)
            if (config?.moduleAssetInsertError) {
              return Promise.resolve({ error: config.moduleAssetInsertError })
            }
            return Promise.resolve({ error: null })
          }),
        }
      }
      return {}
    }),
    storage: {
      from: vi.fn((bucket: string) => ({
        upload: vi.fn((path: string, data: unknown) => {
          calls.storageUploads.push({ bucket, path, data })
          if (config?.storageUploadError) {
            return Promise.resolve({ error: config.storageUploadError })
          }
          return Promise.resolve({ data: { path }, error: null })
        }),
        remove: vi.fn((paths: string[]) => {
          calls.storageRemovals.push({ bucket, paths })
          return Promise.resolve({ data: [], error: config?.storageRemoveError ?? null })
        }),
        getPublicUrl: vi.fn((path: string) => ({
          data: { publicUrl: `https://storage.example.com/${path}` },
        })),
      })),
    },
  }

  return { client, calls }
}

// ============================================================================
// Tests
// ============================================================================

describe('importRbx', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // Successful import
  // --------------------------------------------------------------------------

  describe('successful import', () => {
    it('imports a minimal character (no assets, no modules)', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult()

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      expect(result.characterId).toBe('char-test-123')
      expect(result.stats?.assetsUploaded).toBe(0)
      expect(result.stats?.modulesCreated).toBe(0)
      expect(result.stats?.lorebookEntries).toBe(0)

      // Character insert was called with correct data
      expect(mock.calls.characterInserts).toHaveLength(1)
      expect(mock.calls.characterInserts[0].name).toBe('Test Character')
      expect(mock.calls.characterInserts[0].user_id).toBe('user-123')
      expect(mock.calls.characterInserts[0].visibility).toBe('private')

      // Metadata update was called
      expect(mock.calls.characterUpdates).toHaveLength(1)
      expect(mock.calls.characterUpdates[0].id).toBe('char-test-123')
    })

    it('imports character with assets', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'icon.webp',
              asset_type: 'icon',
              content_type: 'image/webp',
              display_name: 'Icon',
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
            {
              file_name: 'char.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: 'Character',
              canonical_name: 'default',
              display_order: 1,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('icon.webp'), createAssetFile('char.png')],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      expect(result.stats?.assetsUploaded).toBe(2)
      expect(result.stats?.failedAssets).toBe(0)
      expect(mock.calls.assetInserts).toHaveLength(2)
      expect(mock.calls.storageUploads).toHaveLength(2)
    })

    it('imports character with modules (lorebook + regex)', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          modules: [
            {
              enabled: true,
              priority: 0,
              module: {
                name: 'Test Module',
                description: 'A test module',
                lorebook: [
                  {
                    key: 'magic,spell',
                    content: 'Magic system description',
                    secondkey: '',
                    insertorder: 100,
                    alwaysActive: false,
                    selective: false,
                    useRegex: false,
                    comment: 'Magic lore',
                  },
                ],
                regex: [
                  {
                    in: '\\[HP:(\\d+)\\]',
                    out: '',
                    type: 'extract' as const,
                    bindings: { hp: '$1' },
                  },
                ],
                hide_icon: false,
                assets: [],
              },
            },
          ],
        },
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      expect(result.stats?.modulesCreated).toBe(1)
      expect(result.stats?.lorebookEntries).toBe(1)
      expect(mock.calls.moduleInserts).toHaveLength(1)
      expect(mock.calls.moduleInserts[0].name).toBe('Test Module')
      expect(mock.calls.characterModuleLinks).toHaveLength(1)
      expect(mock.calls.characterModuleLinks[0].enabled).toBe(true)
      expect(mock.calls.characterModuleLinks[0].priority).toBe(0)
    })

    it('respects visibility override from caller', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult()

      await importRbx({
        userId: 'user-123',
        parseResult,
        visibility: 'public',
        supabaseClient: mock.client,
      })

      expect(mock.calls.characterInserts[0].visibility).toBe('public')
    })

    it('uses manifest visibility when no override provided', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: { character: { visibility: 'draft' } as RbxManifest['character'] },
      })

      await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(mock.calls.characterInserts[0].visibility).toBe('draft')
    })

    it('rejects invalid SUU cards before character creation', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          character: {
            name: 'Warning Card',
            description: null,
            system_prompt: 'Test',
            greeting_message: null,
            visibility: 'private',
            metadata: {
              type: 'character' as const,
              post_history_instructions: null,
              alternate_greetings: [],
              ui_card: {
                meta: { name: 'legacy', version: '1.0.0' },
                views: {
                  Main: {
                    type: 'UnknownThing',
                  },
                },
              },
              ui_cards: {},
              background_html: null,
              default_variables: {},
              character_list: [],
              image_commands: {},
              image_display: null,
            },
          },
        },
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unsafe SUU content detected in RBX import')
      expect(result.error).toContain('[SCHEMA_ERROR]')
      expect(result.error).toContain('character.metadata.ui_card.views.Main')
      expect(mock.calls.characterInserts).toHaveLength(0)
      expect(mock.calls.characterDeletes).toHaveLength(0)
    })
  })

  // --------------------------------------------------------------------------
  // Asset upload behavior
  // --------------------------------------------------------------------------

  describe('asset upload behavior', () => {
    it('sets avatar_url from icon asset', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'icon.png',
              asset_type: 'icon',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('icon.png')],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      // Avatar URL should be set in the character update
      const updateData = mock.calls.characterUpdates[0].data
      expect(updateData.avatar_url).toMatch(/^https:\/\/storage\.example\.com\//)
    })

    it('tracks failed assets with correct fileName and reason', async () => {
      const mock = createMockSupabase({ assetInsertError: { message: 'DB insert failed' } })
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'a.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('a.png')],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      expect(result.stats?.failedAssets).toBe(1)
      expect(result.stats?.failedAssetSamples).toHaveLength(1)
      expect(result.stats?.failedAssetSamples[0].fileName).toBe('a.png')
      expect(result.stats?.failedAssetSamples[0].reason).toContain('DB insert failed')
    })

    it('cleans up uploaded character storage when character_assets insert fails', async () => {
      const mock = createMockSupabase({ assetInsertError: { message: 'DB insert failed' } })
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'a.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('a.png')],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      expect(mock.calls.storageRemovals).toHaveLength(1)
      expect(mock.calls.storageRemovals[0].bucket).toBe('character-assets')
      expect(mock.calls.storageRemovals[0].paths).toHaveLength(1)
      expect(mock.calls.storageRemovals[0].paths[0]).toMatch(/^user-123\/char-test-123\/.+\.png$/)
    })

    it('fails the import when cleanup of an orphaned character upload also fails', async () => {
      const mock = createMockSupabase({
        assetInsertError: { message: 'DB insert failed' },
        storageRemoveError: { message: 'storage remove failed' },
      })
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'a.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('a.png')],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Failed to remove storage objects: storage remove failed')
      expect(mock.calls.storageRemovals).toHaveLength(1)
    })

    it('counts missing asset files as failed and records fileName', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'missing.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        // No characterAssets → file not found in ZIP
        characterAssets: [],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      expect(result.stats?.failedAssets).toBe(1)
      expect(result.stats?.failedAssetSamples[0].fileName).toBe('missing.png')
      expect(result.stats?.failedAssetSamples[0].reason).toContain('File not found')
    })

    it('retries on 5xx storage errors with exponential backoff', async () => {
      vi.useFakeTimers()
      const mock = createMockSupabase({
        storageUploadError: { message: 'Internal server error', status: 503 },
      })
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'test.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('test.png')],
      })

      const resultPromise = importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // 4 attempts (1 initial + 3 retries)
      expect(mock.calls.storageUploads).toHaveLength(4)
      // Should still succeed import (failed asset tracked in stats)
      expect(result.success).toBe(true)
      expect(result.stats?.failedAssets).toBe(1)

      vi.useRealTimers()
    })

    it('does not retry on 4xx storage errors', async () => {
      vi.useFakeTimers()
      const mock = createMockSupabase({
        storageUploadError: { message: 'Not found', status: 404 },
      })
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'test.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('test.png')],
      })

      const resultPromise = importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // Only 1 attempt, no retries
      expect(mock.calls.storageUploads).toHaveLength(1)
      expect(result.stats?.failedAssets).toBe(1)

      vi.useRealTimers()
    })

    it('recovers after transient failures (eventual success)', async () => {
      vi.useFakeTimers()

      // Stateful mock: fail twice with 503, then succeed on 3rd attempt
      let uploadAttempts = 0
      const mock = createMockSupabase()
      const originalStorageFrom = mock.client.storage.from
      mock.client.storage.from = vi.fn((bucket: string) => ({
        upload: vi.fn((path: string, data: unknown) => {
          mock.calls.storageUploads.push({ bucket, path, data })
          uploadAttempts++
          if (uploadAttempts <= 2) {
            return Promise.resolve({
              error: { message: 'Service unavailable', status: 503 },
            })
          }
          return Promise.resolve({ data: { path }, error: null })
        }),
        remove: originalStorageFrom(bucket).remove,
        getPublicUrl: originalStorageFrom(bucket).getPublicUrl,
      }))

      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'recover.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('recover.png')],
      })

      const resultPromise = importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      // 3 storage attempts: 2 failures + 1 success
      expect(mock.calls.storageUploads).toHaveLength(3)
      // Asset should be uploaded successfully, not counted as failed
      expect(result.success).toBe(true)
      expect(result.stats?.assetsUploaded).toBe(1)
      expect(result.stats?.failedAssets).toBe(0)

      vi.useRealTimers()
    })

    it('retries on network/timeout errors', async () => {
      vi.useFakeTimers()
      const mock = createMockSupabase({
        storageUploadError: { message: 'network connection lost' },
      })
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'test.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('test.png')],
      })

      const resultPromise = importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(mock.calls.storageUploads).toHaveLength(4)
      expect(result.stats?.failedAssets).toBe(1)

      vi.useRealTimers()
    })
  })

  // --------------------------------------------------------------------------
  // Module creation
  // --------------------------------------------------------------------------

  describe('module creation', () => {
    it('creates module with extract regex and bindings', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          modules: [
            {
              enabled: true,
              priority: 10,
              module: {
                name: 'Status Module',
                description: null,
                lorebook: [],
                regex: [
                  {
                    in: '\\[HP:(\\d+)/(\\d+)\\|Loc:([^\\]]+)\\]',
                    out: '',
                    type: 'extract' as const,
                    bindings: { hp: '$1', maxHp: '$2', location: '$3' },
                    card_ref: 'status',
                  },
                ],
                hide_icon: false,
                assets: [],
              },
            },
          ],
        },
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      const insertedRegex = mock.calls.moduleInserts[0].regex as Array<Record<string, unknown>>
      expect(insertedRegex[0].type).toBe('extract')
      expect(insertedRegex[0].bindings).toEqual({ hp: '$1', maxHp: '$2', location: '$3' })
      expect(insertedRegex[0].card_ref).toBe('status')
    })

    it('uploads module assets', async () => {
      vi.useFakeTimers()
      const mock = createMockSupabase()
      const moduleAssetFiles = new Map<number, RbxAssetFile[]>()
      moduleAssetFiles.set(0, [createAssetFile('bg.webp')])

      const parseResult = createMinimalParseResult({
        manifest: {
          modules: [
            {
              enabled: true,
              priority: 0,
              module: {
                name: 'BG Module',
                description: null,
                lorebook: [],
                regex: [],
                hide_icon: false,
                assets: [
                  {
                    file_name: 'bg.webp',
                    content_type: 'image/webp',
                    display_name: 'Background',
                    display_order: 0,
                    metadata: {},
                  },
                ],
              },
            },
          ],
        },
        moduleAssets: moduleAssetFiles,
      })

      const resultPromise = importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(result.success).toBe(true)
      expect(result.stats?.moduleAssetsUploaded).toBe(1)
      // Storage upload to module-assets bucket
      const moduleUploads = mock.calls.storageUploads.filter((u) => u.bucket === 'module-assets')
      expect(moduleUploads).toHaveLength(1)

      vi.useRealTimers()
    })

    it('cleans up uploaded module storage when module_assets insert fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mock = createMockSupabase({
        moduleAssetInsertError: { message: 'module asset insert failed' },
      })
      const moduleAssetFiles = new Map<number, RbxAssetFile[]>()
      moduleAssetFiles.set(0, [createAssetFile('bg.webp')])

      const parseResult = createMinimalParseResult({
        manifest: {
          modules: [
            {
              enabled: true,
              priority: 0,
              module: {
                name: 'BG Module',
                description: null,
                lorebook: [],
                regex: [],
                hide_icon: false,
                assets: [
                  {
                    file_name: 'bg.webp',
                    content_type: 'image/webp',
                    display_name: 'Background',
                    display_order: 0,
                    metadata: {},
                  },
                ],
              },
            },
          ],
        },
        moduleAssets: moduleAssetFiles,
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      expect(result.stats?.moduleAssetsUploaded).toBe(0)
      expect(mock.calls.storageRemovals).toHaveLength(1)
      expect(mock.calls.storageRemovals[0].bucket).toBe('module-assets')
      expect(mock.calls.storageRemovals[0].paths).toHaveLength(1)
      expect(mock.calls.storageRemovals[0].paths[0]).toMatch(/^user-123\/mod-test-0\/.+\.webp$/)
      errorSpy.mockRestore()
    })

    it('does not persist legacy triggers and toggle_definitions', async () => {
      const mock = createMockSupabase()
      const v1Module = {
        name: 'V1 Module',
        description: null,
        lorebook: [],
        regex: [],
        hide_icon: false,
        assets: [],
        // v1.0 fields passed through via .passthrough()
        triggers: [{ name: 'Test Trigger', effects: [{ type: 'v2SetVar', key: 'x', value: '1' }] }],
        toggle_definitions: { wideView: { label: 'Wide', type: 'boolean', default: '0' } },
      }

      const parseResult = createMinimalParseResult({
        manifest: {
          modules: [{ enabled: true, priority: 0, module: v1Module as never }],
        },
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      const inserted = mock.calls.moduleInserts[0]
      expect(inserted.triggers).toBeUndefined()
      expect(inserted.toggle_definitions).toBeUndefined()
    })

    it('creates character_modules link with correct priority', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          modules: [
            {
              enabled: false,
              priority: 5,
              module: {
                name: 'Mod',
                description: null,
                lorebook: [],
                regex: [],
                hide_icon: false,
                assets: [],
              },
            },
          ],
        },
      })

      await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(mock.calls.characterModuleLinks[0]).toMatchObject({
        character_id: 'char-test-123',
        module_id: 'mod-test-0',
        enabled: false,
        priority: 5,
      })
    })
  })

  // --------------------------------------------------------------------------
  // Metadata handling
  // --------------------------------------------------------------------------

  describe('metadata handling', () => {
    it('sets imported_from to rbx_v1.1 after metadata update', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult()

      await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      const updateData = mock.calls.characterUpdates[0].data
      const metadata = updateData.metadata as Record<string, unknown>
      expect(metadata.imported_from).toBe('rbx_v1.1')
    })

    it('resolves image_commands to asset IDs', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          character: {
            name: 'Nia',
            system_prompt: 'You are Nia.',
            description: null,
            greeting_message: null,
            visibility: 'private',
            metadata: {
              type: 'character' as const,
              post_history_instructions: null,
              alternate_greetings: [],
              ui_card: null,
              ui_cards: {},
              background_html: null,
              default_variables: {},
              character_list: [],
              image_commands: { Nia: 'nia.png', Nia_Happy: 'nia_happy.webp' },
              image_display: null,
            },
          },
          assets: [
            {
              file_name: 'nia.png',
              asset_type: 'character_image',
              content_type: 'image/png',
              display_name: 'Nia',
              canonical_name: 'Nia',
              display_order: 0,
              metadata: { aliases: [] },
            },
            {
              file_name: 'nia_happy.webp',
              asset_type: 'character_image',
              content_type: 'image/webp',
              display_name: 'Nia Happy',
              canonical_name: 'Nia_Happy',
              display_order: 1,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('nia.png'), createAssetFile('nia_happy.webp')],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      const metadata = mock.calls.characterUpdates[0].data.metadata as Record<string, unknown>
      const imageCommands = metadata.image_commands as Record<string, string>
      // Resolved to asset IDs
      expect(imageCommands.Nia).toBe('asset-0')
      expect(imageCommands.Nia_Happy).toBe('asset-1')
    })

    it('warns about unresolved image_commands', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          character: {
            name: 'Test',
            system_prompt: 'Test.',
            description: null,
            greeting_message: null,
            visibility: 'private',
            metadata: {
              type: 'character' as const,
              post_history_instructions: null,
              alternate_greetings: [],
              ui_card: null,
              ui_cards: {},
              background_html: null,
              default_variables: {},
              character_list: [],
              image_commands: { Ghost: 'ghost.png' },
              image_display: null,
            },
          },
        },
        // No assets uploaded → ghost.png won't resolve
        characterAssets: [],
      })

      await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('image_commands'),
        // Don't check exact string, just that it was called about unresolved reference
      )
      warnSpy.mockRestore()
    })

    it('preserves ui_card in metadata', async () => {
      const mock = createMockSupabase()
      const uiCard = {
        meta: { name: 'test-panel', version: '1.0.0' },
        state: { hp: 100 },
        views: { Main: { type: 'Column', children: [] } },
      }
      const parseResult = createMinimalParseResult({
        manifest: {
          character: {
            name: 'Test',
            system_prompt: 'Test.',
            description: null,
            greeting_message: null,
            visibility: 'private',
            metadata: {
              type: 'character' as const,
              post_history_instructions: null,
              alternate_greetings: [],
              ui_card: uiCard,
              ui_cards: {},
              background_html: null,
              default_variables: {},
              character_list: [],
              image_commands: {},
              image_display: null,
            },
          },
        },
      })

      await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      const metadata = mock.calls.characterUpdates[0].data.metadata as Record<string, unknown>
      expect(metadata.ui_card).toEqual(uiCard)
    })

    it('clears forbidden background_html before writing metadata', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          character: {
            name: 'Legacy Background',
            system_prompt: 'Test.',
            description: null,
            greeting_message: null,
            visibility: 'private',
            metadata: {
              type: 'character' as const,
              post_history_instructions: null,
              alternate_greetings: [],
              ui_card: null,
              ui_cards: {},
              background_html: '<div>legacy panel</div>',
              default_variables: {},
              character_list: [],
              image_commands: {},
              image_display: null,
            },
          },
        },
      })

      await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      const insertedMetadata = mock.calls.characterInserts[0].metadata as Record<string, unknown>
      const updatedMetadata = mock.calls.characterUpdates[0].data.metadata as Record<
        string,
        unknown
      >
      expect(insertedMetadata.background_html).toBeNull()
      expect(updatedMetadata.background_html).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // Rollback on failure
  // --------------------------------------------------------------------------

  describe('rollback on failure', () => {
    it('rejects unsafe SUU content before creating a character', async () => {
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        manifest: {
          character: {
            name: 'Unsafe Card',
            description: null,
            system_prompt: 'Test',
            greeting_message: null,
            visibility: 'private',
            metadata: {
              type: 'character' as const,
              post_history_instructions: null,
              alternate_greetings: [],
              ui_card: {
                meta: { name: 'remote-image', version: '1.0.0' },
                views: {
                  Main: {
                    type: 'Image',
                    src: 'https://evil.test/x.png',
                    alt: 'Remote image',
                  },
                },
              },
              ui_cards: {},
              background_html: null,
              default_variables: {},
              character_list: [],
              image_commands: {},
              image_display: null,
            },
          },
        },
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unsafe SUU content detected in RBX import')
      expect(result.error).toContain('[EXTERNAL_URL]')
      expect(mock.calls.characterInserts).toHaveLength(0)
      expect(mock.calls.characterDeletes).toHaveLength(0)
    })

    it('returns error without rollback when character creation fails', async () => {
      const mock = createMockSupabase({
        characterInsertError: { message: 'Unique constraint violated' },
      })
      const parseResult = createMinimalParseResult()

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unique constraint violated')
      // No character created, so no delete needed
      expect(mock.calls.characterDeletes).toHaveLength(0)
    })

    it('deletes character when metadata update fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mock = createMockSupabase({
        characterUpdateError: { message: 'Connection lost' },
      })
      const parseResult = createMinimalParseResult({
        manifest: {
          assets: [
            {
              file_name: 'icon.png',
              asset_type: 'icon',
              content_type: 'image/png',
              display_name: null,
              canonical_name: null,
              display_order: 0,
              metadata: { aliases: [] },
            },
          ],
        },
        characterAssets: [createAssetFile('icon.png')],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection lost')
      expect(mock.calls.characterDeletes).toContain('char-test-123')
      expect(mock.calls.storageRemovals).toHaveLength(1)
      expect(mock.calls.storageRemovals[0].bucket).toBe('character-assets')
      expect(mock.calls.storageRemovals[0].paths).toHaveLength(1)
      errorSpy.mockRestore()
    })

    it('deletes character and orphaned modules when module link fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mock = createMockSupabase({
        characterModuleLinkError: { message: 'Link failed' },
      })
      const parseResult = createMinimalParseResult({
        manifest: {
          modules: [
            {
              enabled: true,
              priority: 0,
              module: {
                name: 'Mod',
                description: null,
                lorebook: [],
                regex: [],
                hide_icon: false,
                assets: [],
              },
            },
          ],
        },
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Link failed')
      // Character rolled back
      expect(mock.calls.characterDeletes).toContain('char-test-123')
      // Orphaned module rolled back
      expect(mock.calls.moduleDeletes).toContain('mod-test-0')
      errorSpy.mockRestore()
    })

    it('deletes character and all created modules when second module fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Module insert succeeds for first, fails for second
      let moduleCallCount = 0
      const mock = createMockSupabase()
      // Override module insert to fail on second call
      const originalFrom = mock.client.from
      mock.client.from = vi.fn((table: string) => {
        if (table === 'modules') {
          return {
            insert: vi.fn((data: Record<string, unknown>) => ({
              select: vi.fn(() => ({
                single: vi.fn(() => {
                  mock.calls.moduleInserts.push(data)
                  moduleCallCount++
                  if (moduleCallCount === 2) {
                    return Promise.resolve({
                      data: null,
                      error: { message: 'Second module failed' },
                    })
                  }
                  return Promise.resolve({
                    data: { id: `mod-test-${moduleCallCount - 1}` },
                    error: null,
                  })
                }),
              })),
            })),
            delete: vi.fn(() => ({
              eq: vi.fn((_col: string, id: string) => {
                mock.calls.moduleDeletes.push(id)
                return Promise.resolve({ error: null })
              }),
            })),
          }
        }
        return originalFrom(table)
      })

      const moduleAssetFiles = new Map<number, RbxAssetFile[]>()
      moduleAssetFiles.set(0, [createAssetFile('bg.webp')])

      const parseResult = createMinimalParseResult({
        manifest: {
          modules: [
            {
              enabled: true,
              priority: 0,
              module: {
                name: 'Mod 1',
                description: null,
                lorebook: [],
                regex: [],
                hide_icon: false,
                assets: [
                  {
                    file_name: 'bg.webp',
                    content_type: 'image/webp',
                    display_name: 'Background',
                    display_order: 0,
                    metadata: {},
                  },
                ],
              },
            },
            {
              enabled: true,
              priority: 1,
              module: {
                name: 'Mod 2',
                description: null,
                lorebook: [],
                regex: [],
                hide_icon: false,
                assets: [],
              },
            },
          ],
        },
        moduleAssets: moduleAssetFiles,
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Second module failed')
      expect(mock.calls.characterDeletes).toContain('char-test-123')
      // First module was created and should be rolled back
      expect(mock.calls.moduleDeletes).toHaveLength(1)
      expect(mock.calls.moduleDeletes[0]).toMatch(/^mod-test-/)
      const moduleCleanupCall = mock.calls.storageRemovals.find(
        (call) => call.bucket === 'module-assets',
      )
      expect(moduleCleanupCall).toBeDefined()
      expect(moduleCleanupCall?.paths).toHaveLength(1)
      expect(moduleCleanupCall?.paths[0]).toMatch(/^user-123\/mod-test-0\/.+\.webp$/)
      errorSpy.mockRestore()
    })
  })

  // --------------------------------------------------------------------------
  // Missing assets warning
  // --------------------------------------------------------------------------

  describe('missing assets from parser', () => {
    it('logs warning for missing assets but proceeds', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const mock = createMockSupabase()
      const parseResult = createMinimalParseResult({
        missingAssets: ['missing1.png', 'missing2.webp'],
      })

      const result = await importRbx({
        userId: 'user-123',
        parseResult,
        supabaseClient: mock.client,
      })

      expect(result.success).toBe(true)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('2 asset(s) missing from ZIP'),
        expect.arrayContaining(['missing1.png', 'missing2.webp']),
      )
      warnSpy.mockRestore()
    })
  })
})
