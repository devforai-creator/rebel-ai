import { describe, expect, it, vi } from 'vitest'
import { MAX_IMPORT_UPLOAD_MB } from '@/lib/import/constants'
import {
  buildCharacterImportRequestBody,
  buildUploadPath,
  getCharacterImportErrorMessage,
  getCharacterImportSelectionError,
  getCharacterImportValidationError,
  resolveCharacterImportJobProgress,
  runCharacterDelete,
  startCharacterImportJob,
  submitCharacterForm,
  toggleSelectedModuleIds,
} from './character-ui-logic'

function createImportFile(name: string, type = 'application/octet-stream') {
  return new File(['rbx'], name, { type })
}

describe('character-ui-logic import helpers', () => {
  it('validates RBX selection and size limits', () => {
    expect(getCharacterImportValidationError(null)).toBe('Please select an RBX file.')
    expect(
      getCharacterImportValidationError({
        name: 'guide.json',
        size: 1024,
      }),
    ).toBe('Supported files: .rbx only')
    expect(
      getCharacterImportValidationError({
        name: 'guide.rbx',
        size: (MAX_IMPORT_UPLOAD_MB + 1) * 1024 * 1024,
      }),
    ).toBe(`File size must be ${MAX_IMPORT_UPLOAD_MB}MB or less.`)
    expect(
      getCharacterImportValidationError({
        name: 'guide.rbx',
        size: 1024,
      }),
    ).toBeNull()
  })

  it('rejects unsupported selection before upload and accepts rbx files', () => {
    expect(getCharacterImportSelectionError({ name: 'guide.json', size: 1 })).toBe(
      'Supported files: .rbx only',
    )
    expect(getCharacterImportSelectionError({ name: 'guide.rbx', size: 1 })).toBeNull()
  })

  it('sanitizes upload paths and falls back to a default filename', () => {
    expect(buildUploadPath('user-1', { name: 'My Hero!!.RBX' }, () => 'uuid-1')).toBe(
      'user-1/imports/uuid-1-my-hero.rbx',
    )
    expect(buildUploadPath('user-1', { name: '###' }, () => 'uuid-2')).toBe(
      'user-1/imports/uuid-2-character.rbx',
    )
  })

  it('builds the enqueue payload from upload metadata', () => {
    expect(
      buildCharacterImportRequestBody('user-1/imports/file.rbx', {
        name: 'Guide.rbx',
        size: 42,
        type: 'application/octet-stream',
      }),
    ).toEqual({
      path: 'user-1/imports/file.rbx',
      fileName: 'Guide.rbx',
      fileType: 'application/octet-stream',
      fileSize: 42,
    })
  })

  it('normalizes import errors for operator-visible feedback', () => {
    expect(getCharacterImportErrorMessage(new Error('boom'))).toBe('Import failed: boom')
    expect(getCharacterImportErrorMessage('bad')).toBe('Import failed: Unknown error')
  })

  it('starts a character import job successfully', async () => {
    const upload = vi.fn().mockResolvedValue({
      data: { path: 'user-1/imports/guide.rbx' },
      error: null,
    })
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ jobId: 'job-1', status: 'processing' }),
    })

    const result = await startCharacterImportJob({
      selectedFile: createImportFile('Guide.rbx'),
      supabase: {
        auth: {
          getUser: async () => ({
            data: { user: { id: 'user-1' } },
            error: null,
          }),
        },
        storage: {
          from: () => ({
            upload,
          }),
        },
      },
      fetchImpl,
    })

    expect(result).toMatchObject({
      ok: true,
      jobId: 'job-1',
      jobStatus: 'processing',
      statusMessage: 'Preparing background import job...',
    })
    expect(upload).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/characters/import/storage',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })

  it('returns validation and dependency failures from import startup', async () => {
    const missingFile = await startCharacterImportJob({
      selectedFile: null,
      supabase: {
        auth: { getUser: async () => ({ data: { user: null }, error: null }) },
        storage: {
          from: () => ({
            upload: vi.fn(),
          }),
        },
      },
      fetchImpl: vi.fn(),
    })

    expect(missingFile).toEqual({
      ok: false,
      error: 'Please select an RBX file.',
    })

    const loginFailure = await startCharacterImportJob({
      selectedFile: createImportFile('Guide.rbx'),
      supabase: {
        auth: {
          getUser: async () => ({
            data: { user: null },
            error: null,
          }),
        },
        storage: {
          from: () => ({
            upload: vi.fn(),
          }),
        },
      },
      fetchImpl: vi.fn(),
    })

    expect(loginFailure).toEqual({
      ok: false,
      error: 'Import failed: Login required',
    })
  })

  it('returns upload and enqueue failures from import startup', async () => {
    const uploadFailure = await startCharacterImportJob({
      selectedFile: createImportFile('Guide.rbx'),
      supabase: {
        auth: {
          getUser: async () => ({
            data: { user: { id: 'user-1' } },
            error: null,
          }),
        },
        storage: {
          from: () => ({
            upload: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'storage down' },
            }),
          }),
        },
      },
      fetchImpl: vi.fn(),
    })

    expect(uploadFailure).toEqual({
      ok: false,
      error: 'Import failed: storage down',
    })

    const enqueueFailure = await startCharacterImportJob({
      selectedFile: createImportFile('Guide.rbx'),
      supabase: {
        auth: {
          getUser: async () => ({
            data: { user: { id: 'user-1' } },
            error: null,
          }),
        },
        storage: {
          from: () => ({
            upload: vi.fn().mockResolvedValue({
              data: { path: 'user-1/imports/guide.rbx' },
              error: null,
            }),
          }),
        },
      },
      fetchImpl: vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'queue unavailable' }),
      }),
    })

    expect(enqueueFailure).toEqual({
      ok: false,
      error: 'Import failed: queue unavailable',
    })
  })

  it('resolves job progress updates for success, failure, and active states', () => {
    expect(
      resolveCharacterImportJobProgress({
        ok: true,
        data: {
          status: 'success',
          result: {
            stats: { assetsUploaded: 3 },
          },
        },
      }),
    ).toEqual({
      kind: 'success',
      jobStatus: 'success',
      importStats: { assetsUploaded: 3 },
      statusMessage: 'Import complete! Redirecting to character list...',
    })

    expect(
      resolveCharacterImportJobProgress({
        ok: true,
        data: {
          status: 'error',
          error: 'bad archive',
        },
      }),
    ).toEqual({
      kind: 'error',
      error: 'bad archive',
      jobStatus: 'error',
    })

    expect(
      resolveCharacterImportJobProgress({
        ok: true,
        data: {
          status: 'processing',
        },
      }),
    ).toEqual({
      kind: 'progress',
      jobStatus: 'processing',
      statusMessage: 'Processing RBX package...',
    })

    expect(
      resolveCharacterImportJobProgress({
        ok: true,
        data: {
          status: 'pending',
        },
      }),
    ).toEqual({
      kind: 'progress',
      jobStatus: 'pending',
      statusMessage: 'Waiting in queue...',
    })

    expect(() =>
      resolveCharacterImportJobProgress({
        ok: false,
        data: {
          error: 'fetch failed',
        },
      }),
    ).toThrow('fetch failed')
  })
})

describe('character-ui-logic form and deletion helpers', () => {
  it('toggles selected modules in and out of the form state', () => {
    expect(toggleSelectedModuleIds(['a', 'b'], 'c')).toEqual(['a', 'b', 'c'])
    expect(toggleSelectedModuleIds(['a', 'b'], 'b')).toEqual(['a'])
  })

  it('submits character form data for create and update flows', async () => {
    const createCharacterImpl = vi.fn().mockResolvedValue({ error: null })
    const updateCharacterImpl = vi.fn().mockResolvedValue({ error: 'save failed' })

    const createFormData = new FormData()
    createFormData.set('name', 'Guide')

    await submitCharacterForm({
      formData: createFormData,
      isEditing: false,
      selectedModuleIds: ['mod-1', 'mod-2'],
      createCharacterImpl,
      updateCharacterImpl,
    })

    expect(createCharacterImpl).toHaveBeenCalledOnce()
    expect(createFormData.get('module_ids')).toBe('mod-1,mod-2')

    const updateFormData = new FormData()
    updateFormData.set('name', 'Guide')

    const result = await submitCharacterForm({
      characterId: 'char-1',
      formData: updateFormData,
      isEditing: true,
      selectedModuleIds: ['mod-3'],
      createCharacterImpl,
      updateCharacterImpl,
    })

    expect(updateCharacterImpl).toHaveBeenCalledWith('char-1', updateFormData)
    expect(updateFormData.get('module_ids')).toBe('mod-3')
    expect(result).toEqual({ error: 'save failed' })
  })

  it('delegates character deletion to the provided action', async () => {
    const deleteCharacterImpl = vi
      .fn()
      .mockResolvedValueOnce({ error: 'cannot delete' })
      .mockResolvedValueOnce({ warning: 'linked assets already removed' })

    await expect(
      runCharacterDelete({
        characterId: 'char-1',
        deleteCharacterImpl,
      }),
    ).resolves.toEqual({ error: 'cannot delete' })

    await expect(
      runCharacterDelete({
        characterId: 'char-2',
        deleteCharacterImpl,
      }),
    ).resolves.toEqual({ warning: 'linked assets already removed' })
  })
})
