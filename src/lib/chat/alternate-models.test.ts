import { describe, it, expect } from 'vitest'
import { resolveAlternateApiKeyId } from './alternate-models'

describe('resolveAlternateApiKeyId', () => {
  it('returns selected API key when alternate models disabled', () => {
    const result = resolveAlternateApiKeyId({
      alternateModels: { enabled: false, primaryApiKeyId: 'a', secondaryApiKeyId: 'b' },
      selectedApiKeyId: 'primary',
      messages: [],
    })

    expect(result).toBe('primary')
  })

  it('returns selected API key when secondary key is missing', () => {
    const result = resolveAlternateApiKeyId({
      alternateModels: { enabled: true, primaryApiKeyId: 'a', secondaryApiKeyId: null },
      selectedApiKeyId: 'primary',
      messages: [],
    })

    expect(result).toBe('primary')
  })

  it('alternates to secondary when last assistant used primary', () => {
    const result = resolveAlternateApiKeyId({
      alternateModels: { enabled: true, primaryApiKeyId: 'a', secondaryApiKeyId: 'b' },
      selectedApiKeyId: 'a',
      messages: [
        { role: 'assistant', debug_info: { modelConfig: { apiKeyId: 'a' } } },
        { role: 'user' },
      ],
    })

    expect(result).toBe('b')
  })

  it('alternates to primary when last assistant used secondary', () => {
    const result = resolveAlternateApiKeyId({
      alternateModels: { enabled: true, primaryApiKeyId: 'a', secondaryApiKeyId: 'b' },
      selectedApiKeyId: 'a',
      messages: [
        { role: 'assistant', debug_info: { modelConfig: { apiKeyId: 'b' } } },
        { role: 'user' },
      ],
    })

    expect(result).toBe('a')
  })

  it('defaults to primary when no assistant metadata exists', () => {
    const result = resolveAlternateApiKeyId({
      alternateModels: { enabled: true, primaryApiKeyId: 'a', secondaryApiKeyId: 'b' },
      selectedApiKeyId: 'a',
      messages: [{ role: 'user' }],
    })

    expect(result).toBe('a')
  })
})
