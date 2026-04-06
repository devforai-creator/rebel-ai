import { describe, it, expect } from 'vitest'
import { normalizeChatModelConfig } from './model-config'

describe('normalizeChatModelConfig', () => {
  it('returns empty config when input is invalid', () => {
    expect(normalizeChatModelConfig(null)).toEqual({})
    expect(normalizeChatModelConfig('nope')).toEqual({})
    expect(normalizeChatModelConfig({})).toEqual({})
  })

  it('normalizes alternate model config values', () => {
    const result = normalizeChatModelConfig({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'primary',
        secondaryApiKeyId: 'secondary',
      },
    })

    expect(result).toEqual({
      alternateModels: {
        enabled: true,
        primaryApiKeyId: 'primary',
        secondaryApiKeyId: 'secondary',
      },
    })
  })

  it('coerces non-string ids to null', () => {
    const result = normalizeChatModelConfig({
      alternateModels: {
        enabled: false,
        primaryApiKeyId: 123,
        secondaryApiKeyId: '',
      },
    })

    expect(result).toEqual({
      alternateModels: {
        enabled: false,
        primaryApiKeyId: null,
        secondaryApiKeyId: null,
      },
    })
  })
})
