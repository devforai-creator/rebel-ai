import { describe, expect, it } from 'vitest'
import { readGoogleUsageStep } from './google-usage'
import { priceUsageSteps, sumUsageSteps } from './usage'
import { estimateUsageCost } from '@/lib/model-pricing'

const step = {
  pricingTimestamp: '2026-10-16T00:00:00Z',
  promptTokens: 10000,
  completionTokens: 1500,
  cachedInputTokens: 8000,
  reasoningTokens: 500,
  totalTokens: 12000,
}

describe('Google per-call pricing', () => {
  it.each([
    ['gemini-3.1-pro-preview', 0.1935],
    ['gemini-2.5-pro', 0.12375],
  ] as const)('preserves full Flex cache rates above 200K for %s', (modelName, expected) => {
    expect(
      estimateUsageCost({
        provider: 'google',
        pricingTimestamp: '2026-10-16T00:00:00Z',
        modelName,
        serviceTier: 'flex',
        promptTokens: 250000,
        cachedInputTokens: 200000,
        completionTokens: 1000,
        reasoningTokens: 500,
      })?.totalCost,
    ).toBeCloseTo(expected, 12)
  })
  it('uses actual per-call tiers, falling back only for the call without metadata', () => {
    const steps = [{ ...step, serviceTier: 'standard' as const }, { ...step }]
    expect(
      priceUsageSteps({
        provider: 'google',
        steps,
        modelName: 'gemini-4-argon',
        serviceTier: 'flex',
      })?.totalCost,
    ).toBeCloseTo(0.0248 + 0.0124, 12)
  })
  it('selects the long-context band for each call, including the exact boundary', () => {
    const atBoundary = { ...step, promptTokens: 200000, cachedInputTokens: 0 }
    const above = { ...atBoundary, promptTokens: 200001 }
    expect(
      priceUsageSteps({
        provider: 'google',
        steps: [atBoundary, atBoundary],
        modelName: 'gemini-3.1-pro-preview',
      })?.totalCost,
    ).toBeCloseTo(0.848, 12)
    expect(
      priceUsageSteps({ provider: 'google', steps: [above], modelName: 'gemini-3.1-pro-preview' })
        ?.totalCost,
    ).toBeCloseTo(0.836004, 12)
  })
  it.each([null, undefined, Number.NaN, -1])(
    'keeps incomplete or invalid usage %s unpriced',
    (missing) => {
      expect(
        estimateUsageCost({
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-4-argon',
          promptTokens: missing,
          completionTokens: 1000,
        }),
      ).toBeNull()
      expect(
        estimateUsageCost({
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-4-argon',
          promptTokens: 1000,
          completionTokens: missing,
        }),
      ).toBeNull()
    },
  )
  it('does not return a partial price or partial aggregate when one ATR call is unknown', () => {
    const steps = [step, { ...step, promptTokens: null }]
    expect(priceUsageSteps({ provider: 'google', steps, modelName: 'gemini-4-argon' })).toBeNull()
    expect(sumUsageSteps(steps).promptTokens).toBeNull()
    expect(sumUsageSteps(steps).completionTokens).toBe(3000)
    expect(
      priceUsageSteps({ provider: 'google', steps: [], modelName: 'gemini-4-argon' }),
    ).toBeNull()
    expect(sumUsageSteps([]).promptTokens).toBeNull()
  })
  it('distinguishes valid zero usage from missing usage and defaults optional counters only with usage', () => {
    const known = readGoogleUsageStep({
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      providerMetadata: { google: { pricingTimestamp: '2026-10-16T00:00:00Z' } },
    })
    expect(known).toMatchObject({ cachedInputTokens: 0, reasoningTokens: 0 })
    expect(
      priceUsageSteps({ provider: 'google', steps: [known], modelName: 'gemini-4-argon' })
        ?.totalCost,
    ).toBe(0)
    const unknown = readGoogleUsageStep({
      usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
    })
    expect(unknown).toMatchObject({
      promptTokens: null,
      completionTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
    })
    expect(
      priceUsageSteps({ provider: 'google', steps: [unknown], modelName: 'gemini-4-argon' }),
    ).toBeNull()
  })
})

// Published text-chat rates, verified 2026-10-16. Each column is independent;
// Flex cache reads may stay at Standard even when input/output are halved.
it.each([
  ['gemini-4-argon', 2, 10, 0.1, 1, 5, 0.05],
  ['gemini-3.8-flash', 0.75, 3.75, 0.075, 0.375, 1.875, 0.0375],
  ['gemini-3.6-flash', 0.75, 3.75, 0.075, 0.375, 1.875, 0.0375],
  ['gemini-3.5-flash-lite', 0.3, 2.5, 0.03, 0.15, 1.25, 0.02],
  ['gemini-3.1-flash-lite', 0.25, 1.5, 0.025, 0.125, 0.75, 0.0125],
  ['gemini-3-flash-preview', 0.5, 3, 0.05, 0.25, 1.5, 0.05],
  ['gemini-3.0-flash-preview', 0.5, 3, 0.05, 0.25, 1.5, 0.05],
  ['gemini-3.1-pro-preview', 2, 12, 0.2, 1, 6, 0.2],
  ['gemini-2.5-pro', 1.25, 10, 0.125, 0.625, 5, 0.125],
  ['gemini-2.5-flash', 0.3, 2.5, 0.03, 0.15, 1.25, 0.03],
  ['gemini-2.5-flash-lite', 0.1, 0.4, 0.01, 0.05, 0.2, 0.01],
] as const)(
  'prices %s using its own Standard and Flex rates',
  (modelName, input, output, cached, flexInput, flexOutput, flexCached) => {
    for (const [serviceTier, inRate, outRate, cacheRate] of [
      ['standard', input, output, cached],
      ['flex', flexInput, flexOutput, flexCached],
    ] as const) {
      const cost = estimateUsageCost({
        provider: 'google',
        pricingTimestamp: '2026-10-16T00:00:00Z',
        modelName,
        serviceTier,
        promptTokens: 10000,
        cachedInputTokens: 8000,
        completionTokens: 1000,
        reasoningTokens: 500,
      })!
      expect(cost.promptCost).toBeCloseTo((2000 * inRate) / 1e6, 12)
      expect(cost.cachedInputCost).toBeCloseTo((8000 * cacheRate) / 1e6, 12)
      expect(cost.totalCost).toBeCloseTo(
        (2000 * inRate + 8000 * cacheRate + 1500 * outRate) / 1e6,
        12,
      )
    }
  },
)
