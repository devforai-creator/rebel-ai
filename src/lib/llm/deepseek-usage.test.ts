import { expect, it } from 'vitest'
import { readDeepSeekUsageStep } from './deepseek-usage'
import { priceUsageSteps } from './usage'

const step = {
  usage: {
    inputTokens: 10000,
    outputTokens: 1500,
    totalTokens: 11500,
    reasoningTokens: 500,
    cachedInputTokens: 8000,
  },
  providerMetadata: {
    deepseek: {
      promptCacheHitTokens: 8000,
      promptCacheMissTokens: 2000,
      responseModel: 'deepseek-flash',
      responseTimestamp: '2026-10-16T12:00:00.000Z',
    },
  },
}

it('retains the response model and timestamp and derives missing hit counts from reported miss counts', () => {
  const usage = readDeepSeekUsageStep({
    ...step,
    usage: { ...step.usage, cachedInputTokens: undefined },
  })
  expect(usage).toMatchObject({
    cachedInputTokens: 8000,
    modelName: 'deepseek-flash',
    pricingTimestamp: '2026-10-16T12:00:00.000Z',
  })
  const missOnly = readDeepSeekUsageStep({
    ...step,
    usage: { ...step.usage, cachedInputTokens: undefined },
    providerMetadata: {
      deepseek: {
        ...step.providerMetadata.deepseek,
        promptCacheHitTokens: null,
        promptCacheMissTokens: 2000,
      },
    },
  })
  expect(missOnly.cachedInputTokens).toBe(8000)
})

it.each([
  { promptCacheHitTokens: 8000, promptCacheMissTokens: 3000 },
  { promptCacheHitTokens: 11000, promptCacheMissTokens: 0 },
  {},
])('leaves invalid or missing cache breakdowns unpriced: %j', (metadata) => {
  const usage = readDeepSeekUsageStep({
    ...step,
    usage: { ...step.usage, cachedInputTokens: undefined },
    providerMetadata: { deepseek: metadata },
  })
  expect(usage.cachedInputTokens).toBeNull()
  expect(
    priceUsageSteps({ provider: 'deepseek', modelName: 'deepseek-v4-flash', steps: [usage] }),
  ).toBeNull()
})

it('prices zero reported usage without requiring an omitted zero-cache counter', () => {
  const usage = readDeepSeekUsageStep({
    ...step,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reasoningTokens: 0 },
    providerMetadata: {
      deepseek: { responseModel: 'deepseek-flash', responseTimestamp: '2026-10-16T12:00:00Z' },
    },
  })
  expect(
    priceUsageSteps({ provider: 'deepseek', modelName: 'deepseek-v4-flash', steps: [usage] })
      ?.totalCost,
  ).toBe(0)
})

it('does not substitute the configured model or the current time when response metadata is missing', () => {
  const usage = readDeepSeekUsageStep({ ...step, providerMetadata: undefined })
  expect(
    priceUsageSteps({ provider: 'deepseek', modelName: 'deepseek-v4-flash', steps: [usage] }),
  ).toBeNull()
})
