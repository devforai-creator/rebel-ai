import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const createAdminClientMock = vi.fn()
const parseRbxArchiveMock = vi.fn()
const assertRbxRuntimeContractMock = vi.fn()
const importRbxMock = vi.fn()
const statMock = vi.fn()
const readFileMock = vi.fn()

vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => statMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => createAdminClientMock(),
}))

vi.mock('@/lib/rbx-parser', () => ({
  parseRbxArchive: (...args: unknown[]) => parseRbxArchiveMock(...args),
}))

vi.mock('@/lib/rbx-runtime-contract', () => ({
  assertRbxRuntimeContract: (...args: unknown[]) => assertRbxRuntimeContractMock(...args),
}))

vi.mock('@/lib/rbx-importer', () => ({
  importRbx: (...args: unknown[]) => importRbxMock(...args),
}))

function buildRequest(body: unknown, authHeader?: string, url?: string) {
  return new NextRequest(url ?? 'http://localhost/api/internal/rbx-local-import', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : undefined,
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/rbx-local-import', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    createAdminClientMock.mockReset()
    parseRbxArchiveMock.mockReset()
    assertRbxRuntimeContractMock.mockReset()
    importRbxMock.mockReset()
    statMock.mockReset()
    readFileMock.mockReset()

    vi.stubEnv('LOCAL_RBX_IMPORT_ENABLED', 'true')
    vi.stubEnv('LOCAL_RBX_IMPORT_SECRET', 'local-import-secret')
    vi.stubEnv('NODE_ENV', 'test')

    createAdminClientMock.mockReturnValue({ from: vi.fn(), storage: {} })
    statMock.mockResolvedValue({ isFile: () => true, size: 1024 })
    readFileMock.mockResolvedValue(Buffer.from('rbx-data'))
    parseRbxArchiveMock.mockResolvedValue({
      manifest: { format: 'rbx', version: '1.0', character: { name: 'Test' }, modules: [] },
      characterAssets: [],
      moduleAssets: new Map(),
      missingAssets: [],
    })
    importRbxMock.mockResolvedValue({
      success: true,
      characterId: 'char-123',
      stats: {
        assetsUploaded: 0,
        failedAssets: 0,
        failedAssetSamples: [],
        modulesCreated: 0,
        lorebookEntries: 0,
        moduleAssetsUploaded: 0,
      },
    })
  })

  it('returns 403 when the maintainer tool is disabled', async () => {
    vi.stubEnv('LOCAL_RBX_IMPORT_ENABLED', 'false')
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}, 'Bearer local-import-secret'))

    expect(response.status).toBe(403)
    expect(response.headers.get('X-RebelAI-Support-Tier')).toBe('fallback')
    await expect(response.json()).resolves.toEqual({
      error:
        'Local RBX import is disabled. Set LOCAL_RBX_IMPORT_ENABLED=true to enable this maintainer tool.',
    })
  })

  it('returns 500 when LOCAL_RBX_IMPORT_SECRET is missing', async () => {
    vi.stubEnv('LOCAL_RBX_IMPORT_SECRET', '')
    const { POST } = await import('./route')

    const response = await POST(buildRequest({}, 'Bearer local-import-secret'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Server misconfigured' })
  })

  it('returns 401 when authorization is missing', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          filePath: '/tmp/test.rbx',
          userId: 'user-1',
        },
        undefined,
      ),
    )

    expect(response.status).toBe(401)
  })

  it('returns 403 in production mode', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          filePath: '/tmp/test.rbx',
          userId: 'user-1',
        },
        'Bearer local-import-secret',
      ),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Local RBX import is disabled in production',
    })
  })

  it('returns 403 for non-loopback hosts', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          filePath: '/tmp/test.rbx',
          userId: 'user-1',
        },
        'Bearer local-import-secret',
        'https://example.com/api/internal/rbx-local-import',
      ),
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      error: 'Local RBX import only accepts loopback requests',
    })
  })

  it('rejects relative paths', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          filePath: 'test.rbx',
          userId: 'user-1',
        },
        'Bearer local-import-secret',
      ),
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'filePath must be an absolute local path',
    })
  })

  it('returns 404 when the local RBX file is missing', async () => {
    statMock.mockRejectedValue(Object.assign(new Error('not found'), { code: 'ENOENT' }))
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          filePath: '/tmp/missing.rbx',
          userId: 'user-1',
        },
        'Bearer local-import-secret',
      ),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Local RBX file not found',
    })
  })

  it('normalizes Windows paths and imports with trusted parser limits', async () => {
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          filePath: 'C:\\Users\\tester\\Downloads\\card.rbx',
          userId: 'user-1',
          visibility: 'draft',
        },
        'Bearer local-import-secret',
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('X-RebelAI-Support-Tier')).toBe('fallback')
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      characterId: 'char-123',
      filePath: '/mnt/c/Users/tester/Downloads/card.rbx',
    })
    expect(statMock).toHaveBeenCalledWith('/mnt/c/Users/tester/Downloads/card.rbx')
    expect(readFileMock).toHaveBeenCalledWith('/mnt/c/Users/tester/Downloads/card.rbx')
    expect(parseRbxArchiveMock).toHaveBeenCalledWith(expect.any(Buffer), {
      maxAssetCount: 10_000,
      maxDecompressedMb: 2_048,
      maxManifestBytes: 33_554_432,
    })
    expect(assertRbxRuntimeContractMock).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'rbx' }),
    )
    expect(importRbxMock).toHaveBeenCalledWith({
      userId: 'user-1',
      visibility: 'draft',
      parseResult: expect.any(Object),
      supabaseClient: expect.any(Object),
    })
  })

  it('returns 413 when the file exceeds the maintainer file-size limit', async () => {
    vi.stubEnv('LOCAL_RBX_IMPORT_MAX_FILE_MB', '1')
    statMock.mockResolvedValue({ isFile: () => true, size: 2 * 1024 * 1024 })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          filePath: '/tmp/too-large.rbx',
          userId: 'user-1',
        },
        'Bearer local-import-secret',
      ),
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: 'Local RBX file exceeds 1MB maintainer limit',
    })
    expect(readFileMock).not.toHaveBeenCalled()
    expect(parseRbxArchiveMock).not.toHaveBeenCalled()
  })

  it('returns 500 when importRbx fails', async () => {
    importRbxMock.mockResolvedValue({
      success: false,
      error: 'RBX import failed',
    })
    const { POST } = await import('./route')

    const response = await POST(
      buildRequest(
        {
          filePath: '/tmp/test.rbx',
          userId: 'user-1',
        },
        'Bearer local-import-secret',
      ),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'RBX import failed' })
  })
})
