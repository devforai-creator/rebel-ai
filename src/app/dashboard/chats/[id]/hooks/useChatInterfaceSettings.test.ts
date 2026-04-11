import { describe, expect, it } from 'vitest'

import { resolveInitialChatSettings } from './useChatInterfaceSettings'

const apiKeys = [
  {
    id: 'key-1',
    key_name: 'Primary',
    provider: 'openai',
    model_preference: 'gpt-5-mini',
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

describe('resolveInitialChatSettings', () => {
  it('prefers config primary and secondary ids when both are valid', () => {
    expect(
      resolveInitialChatSettings({
        apiKeys: [...apiKeys],
        preselectedApiKeyId: 'key-3',
        storedApiKeyId: 'key-2',
        normalizedModelConfig: {
          alternateModels: {
            enabled: true,
            primaryApiKeyId: 'key-1',
            secondaryApiKeyId: 'key-2',
          },
          memory: null,
        },
      }),
    ).toEqual({
      primaryApiKeyId: 'key-1',
      secondaryApiKeyId: 'key-2',
      alternateModelsEnabled: true,
    })
  })

  it('falls back from invalid config ids to preselected and stored ids', () => {
    expect(
      resolveInitialChatSettings({
        apiKeys: [...apiKeys],
        preselectedApiKeyId: 'key-3',
        storedApiKeyId: 'key-2',
        normalizedModelConfig: {
          alternateModels: {
            enabled: false,
            primaryApiKeyId: 'missing',
            secondaryApiKeyId: 'also-missing',
          },
          memory: null,
        },
      }),
    ).toEqual({
      primaryApiKeyId: 'key-3',
      secondaryApiKeyId: 'key-1',
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
            secondaryApiKeyId: 'key-1',
          },
          memory: null,
        },
      }),
    ).toEqual({
      primaryApiKeyId: 'key-1',
      secondaryApiKeyId: 'key-1',
      alternateModelsEnabled: false,
    })
  })
})
