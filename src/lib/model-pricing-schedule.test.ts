import { expect, it } from 'vitest'
import { estimateUsageCost } from './model-pricing'
import { priceUsageSteps } from './llm/usage'

const usage = {
  promptTokens: 10000,
  completionTokens: 1000,
  cachedInputTokens: 8000,
  reasoningTokens: 500,
  totalTokens: 11500,
}
it.each([
  ['gemini-4-argon', '2026-12-01T00:00:00Z', 0.0198],
  ['gemini-3.8-flash', '2027-01-01T00:00:00Z', 0.007725],
  ['gemini-3.7-flash', '2027-01-01T00:00:00Z', 0.007725],
  ['gemini-3.6-flash', '2027-01-01T00:00:00Z', 0.007725],
] as const)(
  'switches %s Standard and Flex input, output and cache rates at the published date',
  (modelName, cutoff, standardCost) => {
    for (const serviceTier of ['standard', 'flex'] as const) {
      const base = { ...usage, provider: 'google' as const, modelName, serviceTier }
      const before = estimateUsageCost({
        ...base,
        pricingTimestamp: new Date(Date.parse(cutoff) - 1),
      })!
      const after = estimateUsageCost({ ...base, pricingTimestamp: cutoff })!
      expect(before.totalCost).toBeCloseTo(standardCost * (serviceTier === 'flex' ? 0.5 : 1), 12)
      for (const key of [
        'promptCost',
        'cachedInputCost',
        'completionCost',
        'reasoningCost',
        'totalCost',
      ] as const)
        expect(after[key]).toBeCloseTo(before[key] * 2, 12)
    }
  },
)
it('normalizes offset timestamps and prices each ATR call across the cutoff independently', () => {
  const steps = [
    { ...usage, pricingTimestamp: '2026-11-30T23:59:59Z' },
    { ...usage, pricingTimestamp: '2026-12-01T09:00:00+09:00' },
  ]
  expect(
    priceUsageSteps({ provider: 'google', modelName: 'gemini-4-argon', steps })?.totalCost,
  ).toBeCloseTo(0.0594, 12)
})
it.each([null, undefined, 'invalid'])(
  'does not guess a promotional period from missing or invalid time: %s',
  (pricingTimestamp) => {
    expect(
      estimateUsageCost({
        ...usage,
        provider: 'google',
        modelName: 'gemini-4-argon',
        pricingTimestamp,
      }),
    ).toBeNull()
  },
)
