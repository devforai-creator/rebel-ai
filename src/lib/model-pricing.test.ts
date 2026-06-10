import { describe, it, expect } from 'vitest'
import { estimateUsageCost, type UsageCostParams } from './model-pricing'

describe('estimateUsageCost', () => {
  describe('Google Gemini models', () => {
    describe('gemini-3.5-flash', () => {
      it('should calculate cached input at 10% of input rate', () => {
        const params: UsageCostParams = {
          provider: 'google',
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

    describe('gemini-3-pro-preview', () => {
      it('should calculate cached input at 10% of input rate for tier 1', () => {
        const params: UsageCostParams = {
          provider: 'google',
          modelName: 'gemini-3-pro-preview',
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
          modelName: 'gemini-3-pro-preview',
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
          modelName: 'gemini-3-pro-preview',
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
      // Output cost: (1000 / 1M) * 14 = $0.014
      // Reasoning cost: (500 / 1M) * 14 = $0.007
      expect(result!.promptCost).toBeCloseTo(0.0035, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.0014, 6)
      expect(result!.completionCost).toBeCloseTo(0.014, 6)
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

  describe('DeepSeek models', () => {
    it('should calculate cached input at 20% of input rate', () => {
      const params: UsageCostParams = {
        provider: 'deepseek',
        modelName: 'deepseek-v4-flash',
        promptTokens: 100000,
        completionTokens: 10000,
        cachedInputTokens: 80000,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()

      // Input rate: $0.14/M, Cached rate: $0.028/M (20% of input)
      // Fresh input: 100000 - 80000 = 20000 tokens
      // Fresh cost: (20000 / 1M) * 0.14 = $0.0028
      // Cached cost: (80000 / 1M) * 0.028 = $0.00224
      // Output cost: (10000 / 1M) * 0.28 = $0.0028
      expect(result!.promptCost).toBeCloseTo(0.0028, 6)
      expect(result!.cachedInputCost).toBeCloseTo(0.00224, 6)
      expect(result!.completionCost).toBeCloseTo(0.0028, 6)
    })
  })

  describe('edge cases', () => {
    it('should return null for unknown provider/model combination', () => {
      const params: UsageCostParams = {
        provider: 'google',
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
        modelName: 'gemini-3-pro-preview',
        promptTokens: 0,
        completionTokens: 0,
        cachedInputTokens: 0,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()
      expect(result!.totalCost).toBe(0)
    })

    it('should handle null tokens gracefully', () => {
      const params: UsageCostParams = {
        provider: 'google',
        modelName: 'gemini-3-pro-preview',
        promptTokens: null,
        completionTokens: null,
        cachedInputTokens: null,
      }
      const result = estimateUsageCost(params)
      expect(result).not.toBeNull()
      expect(result!.totalCost).toBe(0)
    })
  })
})
