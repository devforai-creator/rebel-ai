// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useModulesAdmin } from './useModulesAdmin'

const { toastErrorMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
  },
}))

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
}

describe('useModulesAdmin', () => {
  beforeEach(() => {
    toastErrorMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('loads modules on mount through the extracted feature boundary', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        modules: [{ id: 'mod-1', name: 'Alpha' }],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useModulesAdmin())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.modules).toEqual([{ id: 'mod-1', name: 'Alpha' }])
    expect(result.current.error).toBeNull()
  })

  it('removes a module from local state after a successful delete', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          modules: [
            { id: 'mod-1', name: 'Alpha' },
            { id: 'mod-2', name: 'Beta' },
          ],
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ success: true }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useModulesAdmin())

    await waitFor(() => {
      expect(result.current.modules).toHaveLength(2)
    })

    await act(async () => {
      await result.current.removeModule('mod-1')
    })

    expect(result.current.modules).toEqual([{ id: 'mod-2', name: 'Beta' }])
    expect(result.current.deleting).toBeNull()
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('keeps the module list intact and surfaces a toast when delete fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          modules: [{ id: 'mod-1', name: 'Alpha' }],
        }),
      )
      .mockResolvedValueOnce(createJsonResponse({ error: 'Delete failed' }, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useModulesAdmin())

    await waitFor(() => {
      expect(result.current.modules).toEqual([{ id: 'mod-1', name: 'Alpha' }])
    })

    await act(async () => {
      await result.current.removeModule('mod-1')
    })

    expect(result.current.modules).toEqual([{ id: 'mod-1', name: 'Alpha' }])
    expect(toastErrorMock).toHaveBeenCalledWith('Delete failed')
    consoleErrorSpy.mockRestore()
  })
})
