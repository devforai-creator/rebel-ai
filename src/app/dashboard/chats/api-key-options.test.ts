import { describe, expect, it } from 'vitest'
import {
  CHAT_RUNTIME_API_KEY_OPTION_COLUMNS,
  CHAT_SELECTABLE_API_KEY_OPTION_COLUMNS,
  formatChatCredentialLabel,
  formatChatModelOptionLabel,
} from './api-key-options'

describe('chat api key option helpers', () => {
  it('defines the shared selectable and runtime column lists', () => {
    expect(CHAT_SELECTABLE_API_KEY_OPTION_COLUMNS).toBe('id, key_name, provider, model_preference')
    expect(CHAT_RUNTIME_API_KEY_OPTION_COLUMNS).toBe(
      'id, key_name, provider, model_preference, service_tier',
    )
  })

  it('formats a provider credential label', () => {
    expect(
      formatChatCredentialLabel({
        id: 'key-1',
        key_name: 'Primary',
        provider: 'openai',
        model_preference: 'gpt-5-mini',
      }),
    ).toBe('Primary (openai)')
  })

  it('formats a model, credential, prefix, and extra provider detail', () => {
    expect(
      formatChatModelOptionLabel(
        {
          credential: {
            id: 'key-1',
            key_name: 'Primary',
            provider: 'openai',
            model_preference: 'gpt-5-mini',
          },
          modelName: 'gpt-5-mini',
          displayName: 'GPT-5 mini',
          value: 'selection',
        },
        {
          prefix: '보조',
          extraProviderDetail: 'Standard',
        },
      ),
    ).toBe('보조: GPT-5 mini · Primary (openai · Standard)')
  })
})
