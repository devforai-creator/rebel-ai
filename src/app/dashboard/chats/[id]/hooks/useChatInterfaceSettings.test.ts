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
