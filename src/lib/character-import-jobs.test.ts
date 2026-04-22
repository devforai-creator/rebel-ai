import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = { ...process.env }

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

const parseRbxArchiveMock = vi.fn()
const importRbxMock = vi.fn()
const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

vi.mock('@/lib/rbx-parser', () => ({
  parseRbxArchive: (...args: unknown[]) => parseRbxArchiveMock(...args),
}))

vi.mock('@/lib/rbx-importer', () => ({
  importRbx: (...args: unknown[]) => importRbxMock(...args),
}))

type JobUpdateCall = {
  id: string
  payload: Record<string, unknown>
}

type SupabaseFixture = {
  downloadError?: { message: string } | null
  removeError?: { message: string } | null
  bufferByteLength?: number
  downloadDataMissing?: boolean
}

function createSupabaseMock(fixture: SupabaseFixture = {}) {
  const calls = {
    jobUpdates: [] as JobUpdateCall[],
    removedPaths: [] as string[][],
    downloadPaths: [] as string[],
  }

  const bufferByteLength = fixture.bufferByteLength ?? 8

  const client = {
    from: vi.fn((table: string) => {
      if (table !== 'charx_import_jobs') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((_col: string, id: string) => {
            calls.jobUpdates.push({ id, payload })
            return Promise.resolve({ error: null })
          }),
        })),
      }
    }),
    storage: {
      from: vi.fn((bucket: string) => {
        if (bucket !== 'charx-uploads') {
          throw new Error(`Unexpected bucket: ${bucket}`)
        }

        return {
          download: vi.fn((path: string) => {
            calls.downloadPaths.push(path)
            if (fixture.downloadError) {
              return Promise.resolve({
                data: null,
                error: fixture.downloadError,
              })
            }

            if (fixture.downloadDataMissing) {
              return Promise.resolve({
                data: null,
                error: null,
              })
            }

            return Promise.resolve({
              data: {
                arrayBuffer: async () => new ArrayBuffer(bufferByteLength),
              },
              error: null,
            })
          }),
          remove: vi.fn((paths: string[]) => {
            calls.removedPaths.push(paths)
            return Promise.resolve({ error: fixture.removeError ?? null })
          }),
        }
      }),
    },
  }

  return { client, calls }
}

function createValidParseResult() {
  return {
    manifest: {
      format: 'rbx',
      version: '1.1',
      character: {
        name: 'Valid Character',
        description: null,
        system_prompt: 'Test.',
        greeting_message: null,
        visibility: 'private',
        metadata: {
          type: 'character',
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
      },
      assets: [],
      modules: [],
    },
    characterAssets: [],
    moduleAssets: new Map(),
    missingAssets: [],
  }
}

async function loadModule() {
  return import('./character-import-jobs')
}

describe('character-import-jobs', () => {
  beforeEach(() => {
    restoreEnv()
    vi.resetModules()
    vi.clearAllMocks()
    consoleErrorSpy.mockClear()
    parseRbxArchiveMock.mockResolvedValue(createValidParseResult())
    importRbxMock.mockResolvedValue({
      success: true,
      characterId: 'char-1',
      stats: { importedAssets: 0 },
    })
  })

  afterAll(() => {
    restoreEnv()
    consoleErrorSpy.mockRestore()
  })

  it('validateStoragePath accepts scoped paths and rejects foreign paths', async () => {
    const { validateStoragePath } = await loadModule()

    expect(validateStoragePath('user-1/imports/file.rbx', 'user-1')).toBe(true)
    expect(validateStoragePath('user-1/character-assets/file.png', 'user-1')).toBe(false)
    expect(validateStoragePath('user-2/file.rbx', 'user-1')).toBe(false)
  })

  it('marks the job as error and returns early when the storage path is invalid', async () => {
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock()

    const result = await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-2/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(result).toEqual({
      status: 'error',
      error: 'Security validation failed: unauthorized storage path',
    })
    expect(mock.calls.jobUpdates).toHaveLength(1)
    expect(mock.calls.jobUpdates[0]).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'error',
        error_message: 'Security validation failed: unauthorized storage path',
      }),
    })
    expect(mock.calls.downloadPaths).toEqual([])
    expect(mock.calls.removedPaths).toEqual([])
  })

  it('marks the job as success and removes the staged upload after a valid import', async () => {
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock()

    const result = await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(result).toEqual({ status: 'success' })
    expect(parseRbxArchiveMock).toHaveBeenCalledTimes(1)
    expect(importRbxMock).toHaveBeenCalledWith({
      userId: 'user-1',
      parseResult: createValidParseResult(),
      supabaseClient: mock.client,
    })
    expect(mock.calls.jobUpdates).toHaveLength(2)
    expect(mock.calls.jobUpdates[0]).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'processing',
        error_message: null,
      }),
    })
    expect(mock.calls.jobUpdates[1]).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'success',
        result: {
          success: true,
          characterId: 'char-1',
          format: 'rbx',
          stats: { importedAssets: 0 },
        },
      }),
    })
    expect(mock.calls.removedPaths).toContainEqual(['user-1/imports/file.rbx'])
  })

  it('marks the job as error when the staged file cannot be downloaded', async () => {
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock({
      downloadError: { message: 'Storage unavailable' },
    })

    const result = await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(result).toEqual({
      status: 'error',
      error: 'Storage unavailable',
    })
    expect(parseRbxArchiveMock).not.toHaveBeenCalled()
    expect(importRbxMock).not.toHaveBeenCalled()
    expect(mock.calls.jobUpdates.at(-1)).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'error',
        error_message: 'Storage unavailable',
      }),
    })
    expect(mock.calls.removedPaths).toContainEqual(['user-1/imports/file.rbx'])
  })

  it('falls back to a generic download error when storage returns no data', async () => {
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock({
      downloadDataMissing: true,
    })

    await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(mock.calls.jobUpdates.at(-1)).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'error',
        error_message: 'Failed to read uploaded file',
      }),
    })
  })

  it('marks the job as error when the archive exceeds the configured size limit', async () => {
    process.env.NEXT_PUBLIC_IMPORT_MAX_UPLOAD_MB = '10'
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock({
      bufferByteLength: 11 * 1024 * 1024,
    })

    await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(parseRbxArchiveMock).not.toHaveBeenCalled()
    expect(importRbxMock).not.toHaveBeenCalled()
    expect(mock.calls.jobUpdates.at(-1)).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'error',
        error_message: expect.stringContaining('exceeds the 10MB limit'),
      }),
    })
  })

  it('marks the job as error and skips import when the runtime contract is violated', async () => {
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock()

    parseRbxArchiveMock.mockResolvedValue({
      manifest: {
        format: 'rbx',
        version: '1.1',
        character: {
          name: 'Legacy Character',
          description: null,
          system_prompt: 'Test.',
          greeting_message: null,
          visibility: 'private',
          metadata: {
            type: 'character',
            post_history_instructions: null,
            alternate_greetings: [],
            ui_card: null,
            ui_cards: {},
            background_html: '<div>legacy</div>',
            default_variables: {},
            character_list: [],
            image_commands: {},
            image_display: null,
          },
        },
        assets: [],
        modules: [],
      },
      characterAssets: [],
      moduleAssets: new Map(),
      missingAssets: [],
    })

    await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(importRbxMock).not.toHaveBeenCalled()
    expect(mock.calls.jobUpdates.at(-1)).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'error',
        error_message: expect.stringContaining('background_html'),
      }),
    })
    expect(mock.calls.removedPaths).toContainEqual(['user-1/imports/file.rbx'])
  })

  it('marks the job as error when importRbx reports a failure without an explicit message', async () => {
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock()
    importRbxMock.mockResolvedValue({
      success: false,
      error: null,
    })

    await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(mock.calls.jobUpdates.at(-1)).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'error',
        error_message: 'RBX import failed',
      }),
    })
  })

  it('uses an Unknown error fallback for non-Error exceptions and still cleans up', async () => {
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock()
    parseRbxArchiveMock.mockRejectedValue('boom')

    await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(mock.calls.jobUpdates.at(-1)).toMatchObject({
      id: 'job-1',
      payload: expect.objectContaining({
        status: 'error',
        error_message: 'Unknown error',
      }),
    })
    expect(mock.calls.removedPaths).toContainEqual(['user-1/imports/file.rbx'])
  })

  it('logs staged-upload removal failures after processing', async () => {
    const { processCharacterImportJob } = await loadModule()
    const mock = createSupabaseMock({
      removeError: { message: 'cleanup failed' },
    })

    await processCharacterImportJob(
      {
        jobId: 'job-1',
        userId: 'user-1',
        storagePath: 'user-1/imports/file.rbx',
        fileName: 'file.rbx',
      },
      mock.client as never,
    )

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Character Import][runner] Failed to delete staged upload:',
      { message: 'cleanup failed' },
    )
  })
})
