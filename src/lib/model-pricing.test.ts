import { describe, it, expect } from 'vitest'
import { estimateUsageCost, type UsageCostParams } from './model-pricing'

describe('estimateUsageCost', () => {
  it.each(['standard', 'flex'] as const)(
    'prices Luna short and long contexts including cache writes (%s)',
    (serviceTier) => {
      for (const promptTokens of [100_000, 300_000]) {
        const long = promptTokens > 272_000
        const rate = serviceTier === 'flex' ? 0.5 : 1
        const cost = estimateUsageCost({
          provider: 'openai',
          modelName: 'gpt-6-luna',
          serviceTier,
          promptTokens,
          cachedInputTokens: 20_000,
          cacheWriteTokens: 10_000,
          completionTokens: 1_000,
        })!
        expect(cost.totalCost).toBeCloseTo(
          (((promptTokens - 30_000) * 0.1 * (long ? 2 : 1) +
            20_000 * 0.01 * (long ? 2 : 1) +
            10_000 * 0.125 * (long ? 2 : 1) +
            1_000 * 0.5 * (long ? 1.5 : 1)) /
            1_000_000) *
            rate,
          12,
        )
      }
    },
  )
  it('keeps the supplied Anthropic read/write breakdown separate and balanced', () => {
    const cost = estimateUsageCost({
      provider: 'anthropic',
      modelName: 'claude-opus-4-7',
      promptTokens: 32691,
      cachedInputTokens: 106687,
      cacheWriteTokens: 2866,
      cacheWriteTtl: '1h',
      completionTokens: 4128,
    })!
    expect(cost.uncachedPromptCost).toBeCloseTo(0.163455, 12)
    expect(cost.cacheWrite1hCost).toBeCloseTo(0.02866, 12)
    expect(cost.cachedInputCost).toBeCloseTo(0.0533435, 12)
    expect(cost.completionCost).toBeCloseTo(0.1032, 12)
    expect(cost.totalCost).toBeCloseTo(0.3486585, 12)
  })
  it.each(['standard', 'batch'] as const)(
    'charges actual mixed TTLs at their own rates for %s',
    (serviceTier) => {
      const cost = estimateUsageCost({
        provider: 'anthropic',
        modelName: 'claude-opus-4-7',
        promptTokens: 1000,
        cacheWriteTokens: 1000,
        cacheWrite5mTokens: 400,
        cacheWrite1hTokens: 600,
        cacheWriteTtl: '1h',
        serviceTier,
        completionTokens: 0,
      })!
      const multiplier = serviceTier === 'batch' ? 0.5 : 1
      expect(cost.cacheWrite5mCost).toBeCloseTo(0.0025 * multiplier, 12)
      expect(cost.cacheWrite1hCost).toBeCloseTo(0.006 * multiplier, 12)
      expect(cost.totalCost).toBeCloseTo(0.0135 * multiplier, 12)
    },
  )
  it('uses current Haiku 4.5 and full-context Opus 4.6 prices', () => {
    expect(
      estimateUsageCost({
        provider: 'anthropic',
        modelName: 'claude-haiku-4-5',
        promptTokens: 100000,
        completionTokens: 1000,
      })!.totalCost,
    ).toBeCloseTo(0.105, 12)
    expect(
      estimateUsageCost({
        provider: 'anthropic',
        modelName: 'claude-opus-4-6',
        promptTokens: 100000,
        cachedInputTokens: 200000,
        completionTokens: 1000,
      })!.totalCost,
    ).toBeCloseTo(0.625, 12)
  })
  it.each(['5m', '1h'] as const)(
    'charges Anthropic cache writes at the %s rate without double-counting reads',
    (cacheWriteTtl) => {
      for (const serviceTier of ['standard', 'batch'] as const) {
        const result = estimateUsageCost({
          provider: 'anthropic',
          modelName: 'claude-opus-4-7',
          promptTokens: 1000,
          cachedInputTokens: 40000,
          cacheWriteTokens: 10000,
          cacheWriteTtl,
          completionTokens: 2000,
          serviceTier,
        })
        const multiplier = serviceTier === 'batch' ? 0.5 : 1
        expect(result?.promptCost).toBeCloseTo(
          (0.005 + (cacheWriteTtl === '1h' ? 0.1 : 0.0625)) * multiplier,
          8,
        )
        expect(result?.cachedInputCost).toBeCloseTo(0.02 * multiplier, 8)
        expect(result?.completionCost).toBeCloseTo(0.05 * multiplier, 8)
        expect(result?.totalCost).toBeCloseTo(
          (cacheWriteTtl === '1h' ? 0.175 : 0.1375) * multiplier,
          8,
        )
      }
    },
  )

  describe('Google Gemini models', () => {
    describe('gemini-3.8-flash', () => {
      it('should calculate cached input at 10% of the promotional input rate', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.8-flash',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $0.75/M, Cached rate: $0.075/M
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 0.75 = $0.0015
        // Cached cost: (8000 / 1M) * 0.075 = $0.0006
        // Output cost: (1000 / 1M) * 3.75 = $0.00375
        expect(result!.promptCost).toBeCloseTo(0.0015, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.0006, 6)
        expect(result!.completionCost).toBeCloseTo(0.00375, 6)
      })
    })

    describe('gemini-3.7-flash', () => {
      it('should calculate cached input at 10% of the promotional input rate', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.7-flash',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $0.75/M, Cached rate: $0.075/M
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 0.75 = $0.0015
        // Cached cost: (8000 / 1M) * 0.075 = $0.0006
        // Output cost: (1000 / 1M) * 3.75 = $0.00375
        expect(result!.promptCost).toBeCloseTo(0.0015, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.0006, 6)
        expect(result!.completionCost).toBeCloseTo(0.00375, 6)
      })
    })

    describe('gemini-3.6-flash', () => {
      it('should calculate cached input at 10% of the promotional input rate', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.6-flash',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $0.75/M, Cached rate: $0.075/M
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 0.75 = $0.0015
        // Cached cost: (8000 / 1M) * 0.075 = $0.0006
        // Output cost: (1000 / 1M) * 3.75 = $0.00375
        expect(result!.promptCost).toBeCloseTo(0.0015, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.0006, 6)
        expect(result!.completionCost).toBeCloseTo(0.00375, 6)
      })
    })

    describe('gemini-3.5-flash', () => {
      it('should calculate cached input at 10% of input rate', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.5-flash',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $1.50/M, Cached rate: $0.15/M
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 1.5 = $0.003
        // Cached cost: (8000 / 1M) * 0.15 = $0.0012
        // Output cost: (1000 / 1M) * 9 = $0.009
        expect(result!.promptCost).toBeCloseTo(0.003, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.0012, 6)
        expect(result!.completionCost).toBeCloseTo(0.009, 6)
      })
    })

    describe('gemini-3.5-flash-lite', () => {
      it('should calculate cached input at 10% of input rate', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.5-flash-lite',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $0.30/M, Cached rate: $0.03/M
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 0.3 = $0.0006
        // Cached cost: (8000 / 1M) * 0.03 = $0.00024
        // Output cost: (1000 / 1M) * 2.5 = $0.0025
        expect(result!.promptCost).toBeCloseTo(0.0006, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.00024, 6)
        expect(result!.completionCost).toBeCloseTo(0.0025, 6)
      })
    })

    describe('gemini-3.1-flash-lite', () => {
      it('should calculate cached input at 10% of input rate', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.1-flash-lite',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $0.25/M, Cached rate: $0.025/M
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 0.25 = $0.0005
        // Cached cost: (8000 / 1M) * 0.025 = $0.0002
        // Output cost: (1000 / 1M) * 1.5 = $0.0015
        expect(result!.promptCost).toBeCloseTo(0.0005, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.0002, 6)
        expect(result!.completionCost).toBeCloseTo(0.0015, 6)
      })
    })

    describe('gemini-3.1-pro-preview', () => {
      it('should calculate cached input at 10% of input rate for tier 1', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.1-pro-preview',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $2/M, Cached rate: $0.20/M (10% of input)
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 2 = $0.004
        // Cached cost: (8000 / 1M) * 0.2 = $0.0016
        // Output cost: (1000 / 1M) * 12 = $0.012
        expect(result!.promptCost).toBeCloseTo(0.004, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.0016, 6)
        expect(result!.completionCost).toBeCloseTo(0.012, 6)
      })

      it('should use tier 2 pricing for prompts > 200k tokens', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.1-pro-preview',
          promptTokens: 250000,
          completionTokens: 1000,
          cachedInputTokens: 200000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Tier 2: Input $4/M, Cached $0.40/M, Output $18/M
        // Fresh input: 250000 - 200000 = 50000 tokens
        // Fresh cost: (50000 / 1M) * 4 = $0.2
        // Cached cost: (200000 / 1M) * 0.4 = $0.08
        // Output cost: (1000 / 1M) * 18 = $0.018
        expect(result!.promptCost).toBeCloseTo(0.2, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.08, 6)
        expect(result!.completionCost).toBeCloseTo(0.018, 6)
      })

      it('should ensure cached input rate is NOT equal to input rate', () => {
        // This test specifically guards against the regression where
        // cachedInput was missing and fallback to input rate was used
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.1-pro-preview',
          promptTokens: 10000,
          completionTokens: 0,
          cachedInputTokens: 10000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // If cachedInput rate equals input rate (bug), this would be:
        // (10000 / 1M) * 2 = $0.02
        // Correct rate should be:
        // (10000 / 1M) * 0.2 = $0.002 (10x cheaper)
        expect(result!.cachedInputCost).toBeLessThan(0.01) // Must be less than $0.01
        expect(result!.cachedInputCost).toBeCloseTo(0.002, 6)
      })
    })

    describe('gemini-2.5-pro', () => {
      it('should calculate cached input at 10% of input rate for tier 1', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-2.5-pro',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $1.25/M, Cached rate: $0.125/M (10% of input)
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 1.25 = $0.0025
        // Cached cost: (8000 / 1M) * 0.125 = $0.001
        expect(result!.promptCost).toBeCloseTo(0.0025, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.001, 6)
      })

      it('should use tier 2 pricing for prompts > 200k tokens', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-2.5-pro',
          promptTokens: 250000,
          completionTokens: 1000,
          cachedInputTokens: 200000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Tier 2: Input $2.5/M, Cached $0.25/M, Output $15/M
        // Fresh input: 250000 - 200000 = 50000 tokens
        // Fresh cost: (50000 / 1M) * 2.5 = $0.125
        // Cached cost: (200000 / 1M) * 0.25 = $0.05
        expect(result!.promptCost).toBeCloseTo(0.125, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.05, 6)
      })
    })

    describe('gemini-3-flash-preview', () => {
      it('should calculate cached input at 10% of input rate', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3-flash-preview',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()

        // Input rate: $0.50/M, Cached rate: $0.05/M (text)
        // Fresh input: 10000 - 8000 = 2000 tokens
        // Fresh cost: (2000 / 1M) * 0.5 = $0.001
        // Cached cost: (8000 / 1M) * 0.05 = $0.0004
        // Output cost: (1000 / 1M) * 3 = $0.003
        expect(result!.promptCost).toBeCloseTo(0.001, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.0004, 6)
        expect(result!.completionCost).toBeCloseTo(0.003, 6)
      })

      it('should support gemini-3.0-flash-preview alias', () => {
        const params: UsageCostParams = {
          provider: 'google',
          pricingTimestamp: '2026-10-16T00:00:00Z',
          modelName: 'gemini-3.0-flash-preview',
          promptTokens: 10000,
          completionTokens: 1000,
          cachedInputTokens: 8000,
        }
        const result = estimateUsageCost(params)
        expect(result).not.toBeNull()
        expect(result!.promptCost).toBeCloseTo(0.001, 6)
        expect(result!.cachedInputCost).toBeCloseTo(0.0004, 6)
        expect(result!.completionCost).toBeCloseTo(0.003, 6)
      })
    })
  })

  describe('Anthropic models', () => {
    it('should calculate Claude Fable 5.1 pricing correctly', () => {
      const params: UsageCostParams = {
        provider: 'anthropic',
        modelName: 'claude-fable-5-1',
        promptTokens: 2000,
        completionTokens: 500,
        cachedInputTokens: 8000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // Fable 5.1: Input $10/M, Cache hit $0.25/M, Output $50/M.
      expect(result!.promptCost).toBeCloseTo(0.02, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.002, 6)
      expect(result!.completionCost).toBeCloseTo(0.025, 6)
    })

    it('should calculate Claude Fable 5 pricing correctly', () => {
      const params: UsageCostParams = {
        provider: 'anthropic',
        modelName: 'claude-fable-5',
        promptTokens: 2000,
        completionTokens: 500,
        cachedInputTokens: 8000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // Anthropic reports promptTokens as uncached input.
      // Fable 5: Input $10/M, Cache hit $1/M, Output $50/M.
      expect(result!.promptCost).toBeCloseTo(0.02, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.008, 6)
      expect(result!.completionCost).toBeCloseTo(0.025, 6)
    })

    it('should use uncached input tokens directly (Anthropic-specific behavior)', () => {
      // Anthropic AI SDK returns inputTokens as uncached only (already excludes cached)
      const params: UsageCostParams = {
        provider: 'anthropic',
        modelName: 'claude-sonnet-4-5',
        promptTokens: 2000, // This is already uncached
        completionTokens: 500,
        cachedInputTokens: 8000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // Anthropic: inputTokens is already uncached, so we use it directly
      // Fresh cost: (2000 / 1M) * 3 = $0.006
      // Cached cost: (8000 / 1M) * 0.3 = $0.0024
      // Output cost: (500 / 1M) * 15 = $0.0075
      expect(result!.promptCost).toBeCloseTo(0.006, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.0024, 6)
      expect(result!.completionCost).toBeCloseTo(0.0075, 6)
    })

    it('should calculate Claude Sonnet 5 introductory pricing correctly', () => {
      const params: UsageCostParams = {
        provider: 'anthropic',
        modelName: 'claude-sonnet-5',
        promptTokens: 2000,
        completionTokens: 500,
        cachedInputTokens: 8000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // Sonnet 5 introductory pricing: Input $2/M, Cache hit $0.20/M, Output $10/M.
      expect(result!.promptCost).toBeCloseTo(0.004, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.0016, 6)
      expect(result!.completionCost).toBeCloseTo(0.005, 6)
    })

    it('uses Claude Sonnet 5.5 reduced cache-read pricing', () => {
      const estimate = estimateUsageCost({
        provider: 'anthropic',
        modelName: 'claude-sonnet-5-5',
        promptTokens: 2_000,
        completionTokens: 500,
        cachedInputTokens: 8_000,
      })

      expect(estimate?.promptCost).toBeCloseTo(0.004, 8)
      expect(estimate?.cachedInputCost).toBeCloseTo(0.0008, 8)
      expect(estimate?.completionCost).toBeCloseTo(0.005, 8)
    })

    it.each([
      [99_999, 0, 0, 0.1, 0.5, 0.01],
      [100_000, 0, 0, 0.1, 0.5, 0.01],
      [100_001, 0, 0, 0.5, 2.5, 0.05],
      [1_000, 99_000, 0, 0.1, 0.5, 0.01],
      [1_000, 99_001, 0, 0.5, 2.5, 0.05],
      [1_000, 50_000, 49_000, 0.1, 0.5, 0.01],
      [1_000, 50_000, 49_001, 0.5, 2.5, 0.05],
    ])(
      'selects Haiku 5.5 rates for %i uncached, %i cached, and %i cache-write tokens',
      (promptTokens, cachedInputTokens, cacheWriteTokens, input, output, cachedInput) => {
        for (const serviceTier of ['standard', 'batch'] as const) {
          const multiplier = serviceTier === 'batch' ? 0.5 : 1
          const estimate = estimateUsageCost({
            provider: 'anthropic',
            modelName: 'claude-haiku-5-5',
            promptTokens,
            cachedInputTokens,
            cacheWriteTokens,
            completionTokens: 1_000,
            serviceTier,
          })

          expect(estimate?.promptCost).toBeCloseTo(
            ((promptTokens + cacheWriteTokens * 1.25) / 1_000_000) * input * multiplier,
            8,
          )
          expect(estimate?.cachedInputCost).toBeCloseTo(
            (cachedInputTokens / 1_000_000) * cachedInput * multiplier,
            8,
          )
          expect(estimate?.completionCost).toBeCloseTo(0.001 * output * multiplier, 8)
        }
      },
    )

    it('uses Claude Opus 5.5 standard and cached-input rates', () => {
      const estimate = estimateUsageCost({
        provider: 'anthropic',
        modelName: 'claude-opus-5-5',
        promptTokens: 10000,
        completionTokens: 1000,
        cachedInputTokens: 5000,
      })

      expect(estimate?.promptCost).toBeCloseTo(0.04, 6)
      expect(estimate?.cachedInputCost).toBeCloseTo(0.001, 6)
      expect(estimate?.completionCost).toBeCloseTo(0.02, 6)
    })

    it('should apply 0.5x multiplier for Anthropic batch jobs', () => {
      const params: UsageCostParams = {
        provider: 'anthropic',
        modelName: 'claude-opus-4-6',
        promptTokens: 10000,
        completionTokens: 1000,
        cachedInputTokens: 0,
        serviceTier: 'batch',
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // Opus 4.6 batch: standard $5/M input and $25/M output at 50%.
      expect(result!.promptCost).toBeCloseTo(0.025, 6)
      expect(result!.completionCost).toBeCloseTo(0.0125, 6)
    })
  })

  describe('OpenAI models', () => {
    it.each([
      { cachedInputTokens: 900, cacheWriteTokens: 200, reasoningTokens: 0 },
      { cachedInputTokens: 0, cacheWriteTokens: 0, reasoningTokens: 101 },
    ])('leaves inconsistent inclusive token counts unpriced: %j', (counts) => {
      expect(
        estimateUsageCost({
          provider: 'openai',
          modelName: 'gpt-6.1-sol',
          promptTokens: 1000,
          completionTokens: 100,
          ...counts,
        }),
      ).toBeNull()
    })
    it.each([
      ['gpt-5.5', 3.45],
      ['gpt-5.4', 1.725],
    ])('charges the entire long %s request at long-context rates', (modelName, total) => {
      expect(
        estimateUsageCost({
          provider: 'openai',
          modelName: String(modelName),
          promptTokens: 300000,
          completionTokens: 10000,
        })?.totalCost,
      ).toBeCloseTo(Number(total), 12)
    })
    it.each([
      ['gpt-4.1', 0.032],
      ['gpt-4o', 0.045],
      ['gpt-4o-mini', 0.0027],
    ])('prices registered legacy model %s', (modelName, total) => {
      expect(
        estimateUsageCost({
          provider: 'openai',
          modelName: String(modelName),
          promptTokens: 10000,
          cachedInputTokens: 8000,
          completionTokens: 3000,
        })?.totalCost,
      ).toBeCloseTo(Number(total), 12)
    })
    it.each(['gpt-6.1-sol', 'gpt-6-sol', 'gpt-5.6', 'gpt-5.6-sol'])(
      'applies verified %s Fast rates including long context, writes, and reasoning',
      (modelName) => {
        for (const promptTokens of [272000, 272001]) {
          const params = {
            provider: 'openai' as const,
            modelName,
            promptTokens,
            completionTokens: 1500,
            cachedInputTokens: 8000,
            cacheWriteTokens: 1000,
            reasoningTokens: 500,
          }
          const standard = estimateUsageCost(params)!
          const fast = estimateUsageCost({ ...params, serviceTier: 'priority' })!
          expect(fast.totalCost).toBeCloseTo(standard.totalCost * 2, 12)
          expect(fast.cacheWriteCost).toBeCloseTo(standard.cacheWriteCost! * 2, 12)
        }
      },
    )
    it('does not invent a price for an unconfigured Priority rate or unexpected legacy cache writes', () => {
      expect(
        estimateUsageCost({
          provider: 'openai',
          modelName: 'gpt-5.5',
          promptTokens: 1000,
          completionTokens: 100,
          serviceTier: 'priority',
        }),
      ).toBeNull()
      expect(
        estimateUsageCost({
          provider: 'openai',
          modelName: 'gpt-4.1',
          promptTokens: 1000,
          completionTokens: 100,
          cacheWriteTokens: 500,
        }),
      ).toBeNull()
    })
    it('charges GPT-6 Sol writes at their premium and GPT-5.6 Sol at current promotional rates', () => {
      expect(
        estimateUsageCost({
          provider: 'openai',
          modelName: 'gpt-6-sol',
          promptTokens: 10000,
          completionTokens: 1500,
          reasoningTokens: 500,
          cachedInputTokens: 8000,
          cacheWriteTokens: 1000,
        })?.totalCost,
      ).toBeCloseTo(0.0211, 12)
      expect(
        estimateUsageCost({
          provider: 'openai',
          modelName: 'gpt-5.6',
          promptTokens: 10000,
          completionTokens: 1500,
          reasoningTokens: 500,
          cachedInputTokens: 8000,
        })?.totalCost,
      ).toBeCloseTo(0.0412, 12)
    })
    it.each(['standard', 'flex'] as const)(
      'charges GPT-6.1 Sol cache reads, writes, and reasoning once with %s processing',
      (serviceTier) => {
        const estimate = estimateUsageCost({
          provider: 'openai',
          modelName: 'gpt-6.1-sol',
          promptTokens: 10000,
          completionTokens: 1500,
          cachedInputTokens: 8000,
          cacheWriteTokens: 1000,
          reasoningTokens: 500,
          serviceTier,
        })
        const multiplier = serviceTier === 'flex' ? 0.5 : 1

        // 1K ordinary input, 8K cache reads, 1K writes, and 1.5K total output (500 reasoning).
        expect(estimate?.promptCost).toBeCloseTo(0.0045 * multiplier, 8)
        expect(estimate?.cachedInputCost).toBeCloseTo(0.0008 * multiplier, 8)
        expect(estimate?.completionCost).toBeCloseTo(0.01 * multiplier, 8)
        expect(estimate?.reasoningCost).toBeCloseTo(0.005 * multiplier, 8)
        expect(estimate?.totalCost).toBeCloseTo(0.0203 * multiplier, 8)
      },
    )

    it.each([
      { promptTokens: 272000, input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 },
      { promptTokens: 272001, input: 4, cachedInput: 0.2, cacheWrite: 5, output: 15 },
    ])('uses GPT-6.1 Sol rates for the full $promptTokens-token request', (rates) => {
      const estimate = estimateUsageCost({
        provider: 'openai',
        modelName: 'gpt-6.1-sol-2026-09-29',
        promptTokens: rates.promptTokens,
        completionTokens: 10000,
        cachedInputTokens: 100000,
        cacheWriteTokens: 10000,
        reasoningTokens: 3000,
      })

      expect(estimate?.promptCost).toBeCloseTo(
        ((rates.promptTokens - 110000) * rates.input + 10000 * rates.cacheWrite) / 1000000,
        8,
      )
      expect(estimate?.cachedInputCost).toBeCloseTo(0.1 * rates.cachedInput, 8)
      expect(estimate?.completionCost).toBeCloseTo(0.007 * rates.output, 8)
      expect(estimate?.reasoningCost).toBeCloseTo(0.003 * rates.output, 8)
    })

    it('applies GPT-6 Sol long-context rates to the entire request above 272K input tokens', () => {
      const atBoundary = estimateUsageCost({
        provider: 'openai',
        modelName: 'gpt-6-sol',
        promptTokens: 272000,
        completionTokens: 10000,
        cachedInputTokens: 100000,
      })
      const aboveBoundary = estimateUsageCost({
        provider: 'openai',
        modelName: 'gpt-6-sol',
        promptTokens: 300000,
        completionTokens: 10000,
        cachedInputTokens: 100000,
      })

      expect(atBoundary?.promptCost).toBeCloseTo(0.344, 6)
      expect(atBoundary?.cachedInputCost).toBeCloseTo(0.02, 6)
      expect(atBoundary?.completionCost).toBeCloseTo(0.1, 6)
      expect(aboveBoundary?.promptCost).toBeCloseTo(0.8, 6)
      expect(aboveBoundary?.cachedInputCost).toBeCloseTo(0.04, 6)
      expect(aboveBoundary?.completionCost).toBeCloseTo(0.15, 6)
    })

    it('switches GPT-5.6 pricing immediately above the 272K prompt boundary', () => {
      const atBoundary = estimateUsageCost({
        provider: 'openai',
        modelName: 'gpt-5.6',
        promptTokens: 272000,
        completionTokens: 0,
      })
      const aboveBoundary = estimateUsageCost({
        provider: 'openai',
        modelName: 'gpt-5.6-sol',
        promptTokens: 272001,
        completionTokens: 0,
      })

      expect(atBoundary?.promptCost).toBeCloseTo(1.088, 6)
      expect(aboveBoundary?.promptCost).toBeCloseTo(2.176008, 6)
    })

    it('should apply GPT-5.6 long-context pricing above 272K input tokens', () => {
      const params: UsageCostParams = {
        provider: 'openai',
        modelName: 'gpt-5.6',
        promptTokens: 300000,
        completionTokens: 10000,
        cachedInputTokens: 100000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // GPT-5.6 Sol long context: Input $8/M, Cached $0.8/M, Output $30/M.
      expect(result!.promptCost).toBeCloseTo(1.6, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.08, 6)
      expect(result!.completionCost).toBeCloseTo(0.3, 6)
      expect(result!.reasoningCost).toBe(0)
    })

    it('should subtract cached tokens from total input (OpenAI-specific behavior)', () => {
      // OpenAI AI SDK returns inputTokens as total (includes cached)
      const params: UsageCostParams = {
        provider: 'openai',
        modelName: 'gpt-5.1',
        promptTokens: 10000, // Total input including cached
        completionTokens: 500,
        cachedInputTokens: 8000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // OpenAI: subtract cached from total
      // Fresh input: 10000 - 8000 = 2000 tokens
      // Fresh cost: (2000 / 1M) * 1.25 = $0.0025
      // Cached cost: (8000 / 1M) * 0.125 = $0.001
      // Output cost: (500 / 1M) * 10 = $0.005
      expect(result!.promptCost).toBeCloseTo(0.0025, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.001, 6)
      expect(result!.completionCost).toBeCloseTo(0.005, 6)
    })

    it('should calculate gpt-5.2 pricing correctly', () => {
      const params: UsageCostParams = {
        provider: 'openai',
        modelName: 'gpt-5.2',
        promptTokens: 10000,
        completionTokens: 1000,
        cachedInputTokens: 8000,
        reasoningTokens: 500,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // GPT-5.2: Input $1.75/M, Output $14/M, Cached $0.175/M, Reasoning $14/M
      // Fresh input: 10000 - 8000 = 2000 tokens
      // Fresh cost: (2000 / 1M) * 1.75 = $0.0035
      // Cached cost: (8000 / 1M) * 0.175 = $0.0014
      // Visible output: (1000 - 500) / 1M * 14 = $0.007
      // Reasoning cost: (500 / 1M) * 14 = $0.007 (included in total output tokens).
      expect(result!.promptCost).toBeCloseTo(0.0035, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.0014, 6)
      expect(result!.completionCost).toBeCloseTo(0.007, 6)
      expect(result!.reasoningCost).toBeCloseTo(0.007, 6)
    })

    it('should apply 0.5x multiplier for flex service tier', () => {
      const params: UsageCostParams = {
        provider: 'openai',
        modelName: 'gpt-5.1',
        promptTokens: 10000,
        completionTokens: 1000,
        cachedInputTokens: 0,
        serviceTier: 'flex',
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // With flex tier, all costs are halved
      // Input cost: (10000 / 1M) * 1.25 * 0.5 = $0.00625
      // Output cost: (1000 / 1M) * 10 * 0.5 = $0.005
      expect(result!.promptCost).toBeCloseTo(0.00625, 6)
      expect(result!.completionCost).toBeCloseTo(0.005, 6)
    })
  })

  describe('OpenRouter models', () => {
    it('uses the current GLM 5.3 prices', () => {
      const params: UsageCostParams = {
        provider: 'openrouter',
        modelName: 'z-ai/glm-5.3',
        promptTokens: 100000,
        completionTokens: 10000,
        cachedInputTokens: 80000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // Input rate: $1.40/M, Cached rate: $0.26/M, Output rate: $4.40/M.
      // Fresh input: 100000 - 80000 = 20000 tokens.
      expect(result!.promptCost).toBeCloseTo(0.028, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.0208, 6)
      expect(result!.completionCost).toBeCloseTo(0.044, 6)
      expect(result!.totalCost).toBeCloseTo(0.0928, 6)
    })

    it('uses the current Kimi K3 cache-hit price', () => {
      const params: UsageCostParams = {
        provider: 'openrouter',
        modelName: 'moonshotai/kimi-k3',
        promptTokens: 100000,
        completionTokens: 10000,
        cachedInputTokens: 80000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // Input rate: $3/M, Cached rate: $0.30/M, Output rate: $15/M.
      // Fresh input: 100000 - 80000 = 20000 tokens.
      expect(result!.promptCost).toBeCloseTo(0.06, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.024, 6)
      expect(result!.completionCost).toBeCloseTo(0.15, 6)
      expect(result!.totalCost).toBeCloseTo(0.234, 6)
    })
  })

  describe('DeepSeek models', () => {
    it.each([
      ['deepseek-v4-flash', 0.15, 0.003, 0.6],
      ['deepseek-flash', 0.15, 0.003, 0.6],
      ['deepseek-v4-pro', 0.66, 0.022, 1.98],
    ] as const)(
      'prices %s with cache reads and inclusive reasoning at each time period',
      (modelName, input, cached, output) => {
        for (const [pricingTimestamp, multiplier] of [
          ['2026-10-16T12:00:00Z', 1],
          ['2026-10-16T03:00:00Z', 2],
        ] as const) {
          const cost = estimateUsageCost({
            provider: 'deepseek',
            modelName,
            pricingTimestamp,
            promptTokens: 10000,
            completionTokens: 1500,
            cachedInputTokens: 8000,
            reasoningTokens: 500,
          })!
          expect(cost.promptCost).toBeCloseTo((2000 * input * multiplier) / 1000000, 12)
          expect(cost.cachedInputCost).toBeCloseTo((8000 * cached * multiplier) / 1000000, 12)
          expect(cost.completionCost).toBeCloseTo((1000 * output * multiplier) / 1000000, 12)
          expect(cost.reasoningCost).toBeCloseTo((500 * output * multiplier) / 1000000, 12)
          expect(cost.totalCost).toBeCloseTo(
            ((2000 * input + 8000 * cached + 1500 * output) * multiplier) / 1000000,
            12,
          )
        }
      },
    )
    it('leaves missing cache counts or unknown pricing times unpriced', () => {
      const params = {
        provider: 'deepseek' as const,
        modelName: 'deepseek-flash',
        promptTokens: 10000,
        completionTokens: 1500,
      }
      expect(estimateUsageCost({ ...params, pricingTimestamp: '2026-10-16T12:00:00Z' })).toBeNull()
      expect(estimateUsageCost({ ...params, cachedInputTokens: 8000 })).toBeNull()
      expect(
        estimateUsageCost({
          ...params,
          cachedInputTokens: 8000,
          pricingTimestamp: '2027-10-15T01:00:00Z',
        }),
      ).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('should return null for unknown provider/model combination', () => {
      const params: UsageCostParams = {
        provider: 'google',
        pricingTimestamp: '2026-10-16T00:00:00Z',
        modelName: 'unknown-model',
        promptTokens: 1000,
        completionTokens: 100,
      }
      const result = estimateUsageCost(params)
      expect(result).toBeNull()
    })

    it('should handle zero tokens gracefully', () => {
      const params: UsageCostParams = {
        provider: 'google',
        pricingTimestamp: '2026-10-16T00:00:00Z',
        modelName: 'gemini-3.1-pro-preview',
        promptTokens: 0,
        completionTokens: 0,
        cachedInputTokens: 0,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()
      expect(result!.totalCost).toBe(0)
    })

    it('keeps missing Google usage unpriced instead of free', () => {
      const params: UsageCostParams = {
        provider: 'google',
        pricingTimestamp: '2026-10-16T00:00:00Z',
        modelName: 'gemini-3.1-pro-preview',
        promptTokens: null,
        completionTokens: null,
        cachedInputTokens: null,
      }
      const result = estimateUsageCost(params)
      expect(result).toBeNull()
    })
  })
})
