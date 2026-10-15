// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveInitialChatSettings, useChatInterfaceSettings } from './useChatInterfaceSettings'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  updateChatModelConfig: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
  },
}))

vi.mock('../actions', () => ({
  updateChatModelConfig: (...args: unknown[]) => mocks.updateChatModelConfig(...args),
}))

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

const apiKeys = [
  {
    id: 'key-1',
    key_name: 'Primary',
    provider: 'openai',
    model_preference: 'gpt-5.5',
    service_tier: 'standard',
  },
  {
    id: 'key-2',
    key_name: 'Secondary',
    provider: 'anthropic',
    model_preference: 'claude-opus-4-5',
    service_tier: 'standard',
  },
  {
    id: 'key-3',
    key_name: 'Fallback',
    provider: 'google',
    model_preference: 'gemini-2.5-pro',
    service_tier: 'standard',
  },
] as const

beforeEach(() => {
  localStorage.clear()
  mocks.toastError.mockReset()
  mocks.updateChatModelConfig.mockReset()
})

describe('resolveInitialChatSettings', () => {
  it('remembers tiers per model on the same key and rolls back failed saves', async () => {
    const selection = { apiKeyId: 'key-3', modelName: 'gemini-4-argon' }
    const other = { apiKeyId: 'key-3', modelName: 'gemini-3.8-flash' }
    mocks.updateChatModelConfig.mockResolvedValue({ success: true })
    const { result } = renderHook(() =>
      useChatInterfaceSettings({ chatId: 'chat-1', apiKeys: [...apiKeys], isDeveloper: false }),
    )
    expect(result.current.resolveModelServiceTier(selection)).toBe('standard')
    act(() => result.current.handleSelectServiceTier(selection, 'flex'))
    await waitFor(() => expect(mocks.updateChatModelConfig).toHaveBeenCalledTimes(1))
    expect(result.current.resolveModelServiceTier(selection)).toBe('flex')
    expect(result.current.resolveModelServiceTier(other)).toBe('standard')
    act(() => result.current.handleSelectReasoning(selection, 'low'))
    await waitFor(() => expect(mocks.updateChatModelConfig).toHaveBeenCalledTimes(2))
    expect(mocks.updateChatModelConfig).toHaveBeenLastCalledWith(
      'chat-1',
      expect.objectContaining({
        serviceTiers: { 'google:gemini-4-argon': 'flex' },
        reasoning: { 'google:gemini-4-argon': 'low' },
      }),
    )
    mocks.updateChatModelConfig.mockResolvedValueOnce({ error: '저장 실패' })
    act(() => result.current.handleSelectServiceTier(selection, 'standard'))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('저장 실패'))
    expect(result.current.resolveModelServiceTier(selection)).toBe('flex')
  })

  it('prefers config primary and secondary ids when both are valid', () => {
    expect(
      resolveInitialChatSettings({
        apiKeys: [...apiKeys],
        preselectedApiKeyId: 'key-3',
        normalizedModelConfig: {
          alternateModels: {
            enabled: true,
            primaryApiKeyId: 'key-1',
            primaryModelName: 'gpt-5.5',
            secondaryApiKeyId: 'key-2',
            secondaryModelName: 'claude-opus-4-5',
          },
          memory: null,
        },
      }),
    ).toEqual({
      primaryApiKeyId: 'key-1',
      primaryModelName: 'gpt-5.5',
      secondaryApiKeyId: 'key-2',
      secondaryModelName: 'claude-opus-4-5',
      alternateModelsEnabled: true,
    })
  })

  it('falls back from invalid config ids to the preselected credential', () => {
    expect(
      resolveInitialChatSettings({
        apiKeys: [...apiKeys],
        preselectedApiKeyId: 'key-3',
        normalizedModelConfig: {
          alternateModels: {
            enabled: false,
            primaryApiKeyId: 'missing',
            primaryModelName: 'gpt-5.5',
            secondaryApiKeyId: 'also-missing',
            secondaryModelName: 'claude-opus-4-5',
          },
          memory: null,
        },
      }),
    ).toEqual({
      primaryApiKeyId: 'key-3',
      primaryModelName: 'gemini-2.5-pro',
      secondaryApiKeyId: 'key-1',
      secondaryModelName: 'gpt-5.5',
      alternateModelsEnabled: false,
    })
  })

  it('falls back to the first credential when no saved selection is valid', () => {
    expect(
      resolveInitialChatSettings({
        apiKeys: [...apiKeys],
        normalizedModelConfig: {
          alternateModels: {
            enabled: false,
            primaryApiKeyId: 'missing',
            primaryModelName: 'missing-model',
            secondaryApiKeyId: null,
            secondaryModelName: null,
          },
          memory: null,
        },
      }),
    ).toMatchObject({
      primaryApiKeyId: 'key-1',
      primaryModelName: 'gpt-5.5',
      alternateModelsEnabled: false,
    })
  })

  it('disables alternate mode when the resolved primary and secondary keys collide', () => {
    expect(
      resolveInitialChatSettings({
        apiKeys: [...apiKeys],
        normalizedModelConfig: {
          alternateModels: {
            enabled: true,
            primaryApiKeyId: 'key-1',
            primaryModelName: 'gpt-5.5',
            secondaryApiKeyId: 'key-1',
            secondaryModelName: 'gpt-5.5',
          },
          memory: null,
        },
      }),
    ).toEqual({
      primaryApiKeyId: 'key-1',
      primaryModelName: 'gpt-5.5',
      secondaryApiKeyId: 'key-1',
      secondaryModelName: 'gpt-5.5',
      alternateModelsEnabled: false,
    })
  })
})

describe('useChatInterfaceSettings model config persistence', () => {
  it('preserves an explicit summary memory mode when a developer changes reasoning and reloads', async () => {
    mocks.updateChatModelConfig.mockResolvedValue({ success: true })
    const args = { chatId: 'A', apiKeys: [...apiKeys], isDeveloper: true }
    const selection = { apiKeyId: 'key-1', modelName: 'gpt-5.5' }
    const { result, unmount } = renderHook(() =>
      useChatInterfaceSettings({
        ...args,
        initialModelConfig: { memory: { mode: 'summary_window' } },
      }),
    )
    act(() => result.current.handleSelectReasoning(selection, 'low'))
    await waitFor(() => expect(mocks.updateChatModelConfig).toHaveBeenCalledTimes(1))
    const savedConfig = mocks.updateChatModelConfig.mock.calls[0][1]
    expect(savedConfig.memory).toEqual({ mode: 'summary_window' })
    unmount()
    const reloaded = renderHook(() =>
      useChatInterfaceSettings({ ...args, initialModelConfig: savedConfig }),
    )
    expect(reloaded.result.current.memoryMode).toBe('summary_window')
    expect(reloaded.result.current.resolveModelReasoning(selection)).toBe('low')
  })
  it('keeps independent room settings with the same credential and remembers switched models', async () => {
    mocks.updateChatModelConfig.mockResolvedValue({ success: true })
    const selection = { apiKeyId: 'key-1', modelName: 'gpt-5.5' }
    const args = { apiKeys: [...apiKeys], isDeveloper: false, preselectedApiKeyId: 'key-1' }
    const roomA = renderHook(() => useChatInterfaceSettings({ ...args, chatId: 'A' }))
    const roomB = renderHook(() => useChatInterfaceSettings({ ...args, chatId: 'B' }))
    act(() => roomA.result.current.handleSelectReasoning(selection, 'low'))
    act(() => roomB.result.current.handleSelectReasoning(selection, 'medium'))
    await waitFor(() => expect(mocks.updateChatModelConfig).toHaveBeenCalledTimes(2))
    expect(roomA.result.current.resolveModelReasoning(selection)).toBe('low')
    expect(roomB.result.current.resolveModelReasoning(selection)).toBe('medium')
    act(() =>
      roomA.result.current.handleSelectPrimaryModel({
        apiKeyId: 'key-3',
        modelName: 'gemini-4-argon',
      }),
    )
    act(() => roomA.result.current.handleSelectPrimaryModel(selection))
    expect(roomA.result.current.resolveModelReasoning(selection)).toBe('low')
    expect(mocks.updateChatModelConfig).toHaveBeenCalledWith(
      'A',
      expect.objectContaining({ reasoning: { 'openai:gpt-5.5': 'low' } }),
    )
  })

  it('restores reasoning when saving fails and allows explicit default to override a legacy key', async () => {
    const selection = { apiKeyId: 'key-1', modelName: 'gpt-5.5' }
    mocks.updateChatModelConfig
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ error: '저장 실패' })
    const { result } = renderHook(() =>
      useChatInterfaceSettings({
        chatId: 'A',
        apiKeys: [{ ...apiKeys[0], reasoning_effort: 'high' }],
        isDeveloper: false,
      }),
    )
    expect(result.current.resolveModelReasoning(selection)).toBe('high')
    act(() => result.current.handleSelectReasoning(selection, 'default'))
    await waitFor(() => expect(mocks.updateChatModelConfig).toHaveBeenCalledTimes(1))
    expect(result.current.resolveModelReasoning(selection)).toBe('default')
    act(() => result.current.handleSelectReasoning(selection, 'low'))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('저장 실패'))
    expect(result.current.resolveModelReasoning(selection)).toBe('default')
  })
  const initialModelConfig = {
    alternateModels: {
      enabled: false,
      primaryApiKeyId: 'key-1',
      primaryModelName: 'gpt-5.5',
      secondaryApiKeyId: 'key-2',
      secondaryModelName: 'claude-opus-4-5',
    },
    memory: {
      mode: 'prefix_live_blocks' as const,
      retainTailMessages: 4,
    },
  }

  it('serializes rapid model saves so the latest selection is persisted last', async () => {
    const firstSave = createDeferred<{ success: true }>()
    const secondSave = createDeferred<{ success: true }>()
    mocks.updateChatModelConfig
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise)

    const { result } = renderHook(() =>
      useChatInterfaceSettings({
        chatId: 'chat-1',
        apiKeys: [...apiKeys],
        initialModelConfig,
        isDeveloper: false,
      }),
    )

    act(() => {
      result.current.handleSelectPrimaryModel({ apiKeyId: 'key-1', modelName: 'gpt-5.4' })
    })
    act(() => {
      result.current.handleSelectPrimaryModel({
        apiKeyId: 'key-2',
        modelName: 'claude-opus-4-5',
      })
    })

    await waitFor(() => expect(mocks.updateChatModelConfig).toHaveBeenCalledTimes(1))

    await act(async () => {
      firstSave.resolve({ success: true })
      await firstSave.promise
    })
    await waitFor(() => expect(mocks.updateChatModelConfig).toHaveBeenCalledTimes(2))

    expect(mocks.updateChatModelConfig.mock.calls[1]?.[1]).toMatchObject({
      alternateModels: {
        primaryApiKeyId: 'key-2',
        primaryModelName: 'claude-opus-4-5',
      },
    })
    expect(mocks.updateChatModelConfig.mock.calls[1]?.[1]).not.toHaveProperty('experimental')

    await act(async () => {
      secondSave.resolve({ success: true })
      await secondSave.promise
    })
  })

  it('rolls the optimistic model selection back when the latest save fails', async () => {
    mocks.updateChatModelConfig.mockResolvedValueOnce({ error: '모델 설정 저장 실패' })

    const { result } = renderHook(() =>
      useChatInterfaceSettings({
        chatId: 'chat-1',
        apiKeys: [...apiKeys],
        initialModelConfig,
        isDeveloper: false,
      }),
    )

    act(() => {
      result.current.handleSelectPrimaryModel({
        apiKeyId: 'key-2',
        modelName: 'claude-opus-4-5',
      })
    })
    expect(result.current.selectedApiKeyId).toBe('key-2')

    await waitFor(() => {
      expect(result.current.selectedApiKeyId).toBe('key-1')
      expect(result.current.selectedModelName).toBe('gpt-5.5')
    })
    expect(mocks.toastError).toHaveBeenCalledWith('모델 설정 저장 실패')
  })

  it('rolls back and reports an unexpected server action rejection', async () => {
    mocks.updateChatModelConfig.mockRejectedValueOnce(new Error('network unavailable'))

    const { result } = renderHook(() =>
      useChatInterfaceSettings({
        chatId: 'chat-1',
        apiKeys: [...apiKeys],
        initialModelConfig,
        isDeveloper: false,
      }),
    )

    act(() => {
      result.current.handleSelectPrimaryModel({ apiKeyId: 'key-1', modelName: 'gpt-5.4' })
    })

    await waitFor(() => expect(result.current.selectedModelName).toBe('gpt-5.5'))
    expect(mocks.toastError).toHaveBeenCalledWith('network unavailable')
  })
})
