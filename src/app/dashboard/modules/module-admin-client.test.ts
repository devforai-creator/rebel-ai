import { describe, expect, it, vi } from 'vitest'
import { deleteModule, listModules } from './module-admin-client'

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

describe('module-admin-client', () => {
  it('returns module summaries from the route payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        modules: [{ id: 'mod-1', name: 'Alpha' }],
      }),
    )

    await expect(listModules(fetchMock)).resolves.toEqual([{ id: 'mod-1', name: 'Alpha' }])
    expect(fetchMock).toHaveBeenCalledWith('/api/modules', { cache: 'no-store' })
  })

  it('throws the API error message when module loading fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createJsonResponse({ error: 'Unauthorized' }, { status: 401 }))

    await expect(listModules(fetchMock)).rejects.toThrow('Unauthorized')
  })

  it('throws a fallback message when module delete returns an unstructured error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('bad gateway', { status: 502 }))

    await expect(deleteModule('mod-1', fetchMock)).rejects.toThrow('bad gateway')
    expect(fetchMock).toHaveBeenCalledWith('/api/modules?id=mod-1', { method: 'DELETE' })
  })

  it('returns the cleanup warning when delete succeeds with a warning payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        success: true,
        warning: 'Cleanup failed',
      }),
    )

    await expect(deleteModule('mod-1', fetchMock)).resolves.toEqual({
      warning: 'Cleanup failed',
    })
  })
})
