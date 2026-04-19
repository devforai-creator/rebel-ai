// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EMPTY_ASSET_DATA,
  normalizeChatAssetData,
  resolveNextRuntimeVariables,
  useChatRuntimeVariables,
} from './useChatRuntimeVariables'

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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })
  return { promise, resolve, reject }
}

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

describe('useChatRuntimeVariables', () => {
  beforeEach(() => {
    toastErrorMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('loads initial runtime variables from the chat assets payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        createJsonResponse({
          globalVariables: {
            mood: 'happy',
          },
        }),
      ),
    )

    const { result } = renderHook(() => useChatRuntimeVariables('chat-1'))

    await waitFor(() => {
      expect(result.current.runtimeVariables).toEqual({ mood: 'happy' })
    })

    expect(result.current.assetData.globalVariables).toEqual({ mood: 'happy' })
  })

  it('persists optimistic runtime variable updates serially', async () => {
    const firstPersist = createDeferred<Response>()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          globalVariables: {
            mood: 'happy',
          },
        }),
      )
      .mockReturnValueOnce(firstPersist.promise)
      .mockResolvedValueOnce(createJsonResponse({ success: true, count: 2 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatRuntimeVariables('chat-1'))

    await waitFor(() => {
      expect(result.current.runtimeVariables).toEqual({ mood: 'happy' })
    })

    act(() => {
      result.current.handleUiCardAction('button', 'wave')
      result.current.handleUiCardAction('toggle', 'brave', { value: true })
    })

    expect(result.current.runtimeVariables).toEqual({
      mood: 'happy',
      wave: true,
      brave: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/chats/chat-1/variables',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          variables: {
            mood: 'happy',
            wave: true,
          },
        }),
      }),
    )

    firstPersist.resolve(createJsonResponse({ success: true, count: 2 }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/chats/chat-1/variables',
      expect.objectContaining({
        body: JSON.stringify({
          variables: {
            mood: 'happy',
            wave: true,
            brave: true,
          },
        }),
      }),
    )
  })

  it('keeps the latest optimistic state when an earlier persist fails but a newer one succeeds', async () => {
    const firstPersist = createDeferred<Response>()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ globalVariables: { mood: 'happy' } }))
      .mockReturnValueOnce(firstPersist.promise)
      .mockResolvedValueOnce(createJsonResponse({ success: true, count: 2 }))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatRuntimeVariables('chat-1'))

    await waitFor(() => {
      expect(result.current.runtimeVariables).toEqual({ mood: 'happy' })
    })

    act(() => {
      result.current.handleUiCardAction('button', 'wave')
      result.current.handleUiCardAction('toggle', 'brave', { value: true })
    })

    firstPersist.resolve(createJsonResponse({ error: 'Save denied' }, { status: 500 }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    await waitFor(() => {
      expect(result.current.runtimeVariables).toEqual({
        mood: 'happy',
        wave: true,
        brave: true,
      })
    })

    expect(toastErrorMock).not.toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })

  it('rolls back to the last persisted runtime variables when the latest persist fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ globalVariables: { mood: 'happy' } }))
      .mockResolvedValueOnce(createJsonResponse({ error: 'Save denied' }, { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useChatRuntimeVariables('chat-1'))

    await waitFor(() => {
      expect(result.current.runtimeVariables).toEqual({ mood: 'happy' })
    })

    act(() => {
      result.current.handleUiCardAction('button', 'wave')
    })

    expect(result.current.runtimeVariables).toEqual({
      mood: 'happy',
      wave: true,
    })

    await waitFor(() => {
      expect(result.current.runtimeVariables).toEqual({ mood: 'happy' })
    })

    expect(toastErrorMock).toHaveBeenCalledWith('Save denied')
    consoleErrorSpy.mockRestore()
  })
})
