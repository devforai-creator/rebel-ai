import { describe, expect, it } from 'vitest'
import { resolveInvocationSamplingOptions } from './invocation-sampling'

describe('resolveInvocationSamplingOptions', () => {
  it('returns an empty option set for openrouter', () => {
    expect(
      resolveInvocationSamplingOptions({
        provider: 'openrouter',
        modelName: 'openrouter/test',
      }),
    ).toEqual({})
  })

  it('returns an empty option set for openai', () => {
    expect(
      resolveInvocationSamplingOptions({
        provider: 'openai',
        modelName: 'gpt-4.1',
        reasoningEffort: 'high',
      }),
    ).toEqual({})
  })

  it.each(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'])(
    'does not send deprecated sampling options to %s',
    (modelName) => {
      expect(
        resolveInvocationSamplingOptions({
          provider: 'google',
          modelName,
        }),
      ).toEqual({})
    },
  )

  it('returns an empty option set for all other providers', () => {
    expect(
      resolveInvocationSamplingOptions({
        provider: 'anthropic',
        modelName: 'claude-sonnet',
      }),
    ).toEqual({})
  })
})
