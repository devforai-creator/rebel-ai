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

  it('returns an empty option set for all other providers', () => {
    expect(
      resolveInvocationSamplingOptions({
        provider: 'anthropic',
        modelName: 'claude-sonnet',
      }),
    ).toEqual({})
  })
})
