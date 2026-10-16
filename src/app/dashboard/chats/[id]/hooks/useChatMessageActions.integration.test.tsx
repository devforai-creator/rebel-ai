// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useChatUsageStats } from './useChatUsageStats'
import { useChatMessageActions } from './useChatMessageActions'

const mocks = vi.hoisted(() => ({ remove: vi.fn() }))
vi.mock('../message-actions', () => ({ deleteMessage: mocks.remove, editMessage: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})
const response = (latestMessage: unknown) => ({ ok: true, json: async () => ({ latestMessage }) })
function setup(next: unknown = { id: 'older', costUsd: 0.05 }) {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(response({ id: 'latest', costUsd: 0.12 }))
    .mockResolvedValueOnce(response(next))
  vi.stubGlobal('fetch', fetchMock)
  const ids = { current: new Set(['latest']) }
  const debug = { current: new Map() }
  const setMessages = vi.fn()
  const hook = renderHook(() => {
    const stats = useChatUsageStats({ chatId: 'chat', enabled: true, initialUsageStats: null })
    const actions = useChatMessageActions({
      combinedMessages: [{ id: 'latest', role: 'assistant', content: 'Answer' }],
      persistedMessageIds: ids,
      debugInfoMap: debug,
      setMessages,
      reload: vi.fn(),
      onDeleteComplete: stats.fetchLatestUsage,
    })
    return { stats, actions }
  })
  return { ...hook, fetchMock, ids }
}
it('refreshes the collapsed price after deletion completes, without requiring any realtime event', async () => {
  let finish!: (value: unknown) => void
  mocks.remove.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve
    }),
  )
  const { result, fetchMock, ids } = setup()
  await waitFor(() => expect(result.current.stats.latestUsage?.id).toBe('latest'))
  act(() => result.current.actions.requestDelete('latest'))
  let deleting!: Promise<void>
  act(() => {
    deleting = result.current.actions.confirmDelete()
  })
  expect(fetchMock).toHaveBeenCalledTimes(1)
  await act(async () => {
    finish({ success: true })
    await deleting
  })
  expect(result.current.stats.latestUsage).toMatchObject({ id: 'older', costUsd: 0.05 })
  expect(ids.current.has('latest')).toBe(false)
})
it('clears the price when no assistant answer remains', async () => {
  mocks.remove.mockResolvedValue({ success: true })
  const { result } = setup(null)
  await waitFor(() => expect(result.current.stats.latestUsage?.id).toBe('latest'))
  act(() => result.current.actions.requestDelete('latest'))
  await act(async () => result.current.actions.confirmDelete())
  expect(result.current.stats.latestUsage).toBeNull()
})
it('leaves the recorded price intact when deletion fails or is cancelled', async () => {
  mocks.remove.mockResolvedValue({ error: 'Failed' })
  const { result, fetchMock } = setup()
  await waitFor(() => expect(result.current.stats.latestUsage?.id).toBe('latest'))
  await act(async () => result.current.actions.confirmDelete())
  expect(mocks.remove).not.toHaveBeenCalled()
  act(() => result.current.actions.requestDelete('latest'))
  await act(async () => result.current.actions.confirmDelete())
  expect(fetchMock).toHaveBeenCalledTimes(1)
  expect(result.current.stats.latestUsage?.id).toBe('latest')
})
