import { expect, it } from 'vitest'
import { priceUsageSteps, sumUsageSteps, sumReportedUsageCost, type UsageStep } from './usage'

const step: UsageStep = {
  promptTokens: 200000,
  completionTokens: 1000,
  totalTokens: 201000,
  cachedInputTokens: 0,
  reasoningTokens: 0,
  cacheWriteTokens: 0,
}

it('selects long-context rates per call instead of from the ATR aggregate', () => {
  expect(sumUsageSteps([step, step]).promptTokens).toBe(400000)
  expect(
    priceUsageSteps({ provider: 'openai', modelName: 'gpt-5.5', steps: [step, step] })?.totalCost,
  ).toBeCloseTo(2.06, 12)
})

it.each(['openai', 'anthropic', 'google', 'deepseek', 'openrouter'] as const)(
  'keeps incomplete %s aggregates unknown instead of silently summing the known calls',
  (provider) => {
    const steps = [step, { ...step, promptTokens: null }]
    expect(sumUsageSteps(steps).promptTokens).toBeNull()
    expect(priceUsageSteps({ provider, modelName: 'gpt-6.1-sol', steps })).toBeNull()
  },
)

it('distinguishes empty or missing usage from a reported zero-token call', () => {
  expect(priceUsageSteps({ provider: 'openai', modelName: 'gpt-6.1-sol', steps: [] })).toBeNull()
  expect(
    priceUsageSteps({
      provider: 'openai',
      modelName: 'gpt-6.1-sol',
      steps: [{ ...step, promptTokens: 0, completionTokens: 0 }],
    })?.totalCost,
  ).toBe(0)
})

it('sums complete provider costs independently of token usage, including zero', () => {
  expect(
    sumReportedUsageCost([
      { ...step, promptTokens: null, reportedCostUsd: 0 },
      { ...step, reportedCostUsd: 0.032 },
    ]),
  ).toBe(0.032)
  expect(sumReportedUsageCost([])).toBeNull()
})
it.each([undefined, null, -1, NaN, Infinity])(
  'does not publish a partial or invalid provider total: %s',
  (reportedCostUsd) => {
    expect(
      sumReportedUsageCost([
        { ...step, reportedCostUsd: 0.01 },
        { ...step, reportedCostUsd },
      ]),
    ).toBeNull()
  },
)
