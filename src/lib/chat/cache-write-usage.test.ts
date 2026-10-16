import { expect, it } from 'vitest'
import { resolveCacheWriteUsage } from './cache-write-usage'
import { buildUsageReceipt, readUsageReceipt } from './usage-receipt'
import { sumUsageSteps } from '@/lib/llm/usage'

it('preserves native mixed TTL writes and classifies only the remainder using the request TTL', () => {
  const steps = [
    {
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cachedInputTokens: 1000,
      reasoningTokens: null,
      ...resolveCacheWriteUsage(
        { cacheWriteTokens: 200, cacheWrite5mTokens: 50, cacheWrite1hTokens: 150 },
        '1h',
      ),
    },
    {
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      cachedInputTokens: 1000,
      reasoningTokens: null,
      ...resolveCacheWriteUsage({ cacheWriteTokens: 100 }, '1h'),
    },
  ]
  const usage = sumUsageSteps(steps)
  const receipt = buildUsageReceipt({
    requestId: 'request',
    provider: 'anthropic',
    modelName: 'unknown-model',
    callCount: 2,
    usage,
    cost: null,
    cacheWriteTtl: '1h',
  })
  expect(receipt).toMatchObject({ input: 2500, cacheWrite5m: 50, cacheWrite1h: 250, cost: null })
  expect(readUsageReceipt({ usageReceipt: receipt })).toEqual(receipt)
})
it('keeps known native TTL counts even without a reported total', () => {
  expect(resolveCacheWriteUsage({ cacheWrite5mTokens: 50, cacheWrite1hTokens: 150 })).toEqual({
    cacheWriteTokens: 200,
    cacheWrite5mTokens: 50,
    cacheWrite1hTokens: 150,
  })
  expect(resolveCacheWriteUsage({ cacheWrite5mTokens: 50 })).toEqual({ cacheWrite5mTokens: 50 })
})
it('distinguishes an explicitly reported zero from completely missing writes', () => {
  expect(resolveCacheWriteUsage({ cacheWriteTokens: 0 })).toEqual({
    cacheWriteTokens: 0,
    cacheWrite5mTokens: 0,
    cacheWrite1hTokens: 0,
  })
  expect(resolveCacheWriteUsage({})).toEqual({})
})
it('uses the provider default TTL when the request has no override', () => {
  expect(resolveCacheWriteUsage({ cacheWriteTokens: 200 })).toEqual({
    cacheWriteTokens: 200,
    cacheWrite5mTokens: 200,
    cacheWrite1hTokens: 0,
  })
})
