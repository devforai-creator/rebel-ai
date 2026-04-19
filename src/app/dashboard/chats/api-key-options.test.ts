import { describe, expect, it } from 'vitest'
import {
  CHAT_RUNTIME_API_KEY_OPTION_COLUMNS,
  CHAT_SELECTABLE_API_KEY_OPTION_COLUMNS,
  formatChatApiKeyOptionLabel,
} from './api-key-options'

describe('chat api key option helpers', () => {
  it('defines the shared selectable and runtime column lists', () => {
    expect(CHAT_SELECTABLE_API_KEY_OPTION_COLUMNS).toBe('id, key_name, provider, model_preference')
    expect(CHAT_RUNTIME_API_KEY_OPTION_COLUMNS).toBe(
      'id, key_name, provider, model_preference, service_tier',
    )
  })

  it('formats a basic chat API key label by default', () => {
    expect(
      formatChatApiKeyOptionLabel({
        id: 'key-1',
        key_name: 'Primary',
        provider: 'openai',
        model_preference: 'gpt-5-mini',
      }),
    ).toBe('Primary (openai)')
  })

  it('formats model preference, prefix, and extra provider detail when requested', () => {
    expect(
      formatChatApiKeyOptionLabel(
        {
          id: 'key-1',
          key_name: 'Primary',
          provider: 'openai',
          model_preference: 'gpt-5-mini',
        },
        {
          includeModelPreference: true,
          prefix: '보조',
          extraProviderDetail: 'Standard',
        },
      ),
    ).toBe('보조: Primary (openai · Standard) - gpt-5-mini')
  })
})
