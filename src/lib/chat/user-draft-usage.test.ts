import { describe, expect, it } from 'vitest'
import { readUserDraftUsage } from './user-draft-usage'
import { userDraftUsageSchema } from './user-draft-contract'

const base = { modelName: 'model', memoryMode: 'prefix_live_blocks' as const }

describe('draft input billing categories', () => {
  it('subtracts OpenAI reads and writes from inclusive input', () => {
    const usage = readUserDraftUsage({
      ...base,
      provider: 'openai',
      step: {
        usage: {
          inputTokens: 10000,
          outputTokens: 200,
          totalTokens: 10200,
          cachedInputTokens: 8000,
          reasoningTokens: 50,
        },
        providerMetadata: { openai: { usage: { cacheWriteTokens: 1000 } } },
      },
    })!
    expect(usage).toMatchObject({
      inputTokens: 10000,
      cacheHitTokens: 8000,
      cacheMissTokens: 2000,
      cacheWriteTokens: 1000,
      uncachedInputTokens: 1000,
      reasoningTokens: 50,
    })
    expect(userDraftUsageSchema.safeParse(usage).success).toBe(true)
  })

  it('adds Anthropic ordinary input, reads and native mixed-TTL writes to the total', () => {
    const usage = readUserDraftUsage({
      ...base,
      provider: 'anthropic',
      step: {
        usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cachedInputTokens: 8000 },
        providerMetadata: {
          anthropic: {
            usage: {
              cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
            },
          },
        },
      },
    })!
    expect(usage).toMatchObject({
      inputTokens: 10000,
      cacheHitTokens: 8000,
      cacheMissTokens: 2000,
      cacheWriteTokens: 1000,
      uncachedInputTokens: 1000,
    })
    expect(userDraftUsageSchema.safeParse(usage).success).toBe(true)
  })

  it.each(['openai', 'anthropic'])(
    'keeps missing %s usage unknown instead of reporting zero or inventing a total',
    (provider) => {
      const usage = readUserDraftUsage({
        ...base,
        provider,
        step: {
          usage: { inputTokens: undefined, outputTokens: undefined, totalTokens: undefined },
        },
      })
      expect(usage).toMatchObject({
        inputTokens: null,
        cacheHitTokens: null,
        cacheMissTokens: null,
        cacheWriteTokens: null,
        uncachedInputTokens: null,
      })
    },
  )

  it('keeps known Anthropic ordinary input when cache counters are missing', () => {
    expect(
      readUserDraftUsage({
        ...base,
        provider: 'anthropic',
        step: { usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } },
      }),
    ).toMatchObject({
      inputTokens: null,
      cacheHitTokens: null,
      cacheWriteTokens: null,
      uncachedInputTokens: 1000,
    })
  })

  it.each([
    [8000, 3000, 8000, null],
    [11000, 0, null, 0],
  ])(
    'rejects impossible read/write partitions (%s/%s)',
    (read, write, expectedRead, expectedWrite) => {
      expect(
        readUserDraftUsage({
          ...base,
          provider: 'openai',
          step: {
            usage: {
              inputTokens: 10000,
              outputTokens: 200,
              totalTokens: 10200,
              cachedInputTokens: read,
            },
            providerMetadata: { openai: { usage: { cacheWriteTokens: write } } },
          },
        }),
      ).toMatchObject({
        cacheHitTokens: expectedRead,
        cacheWriteTokens: expectedWrite,
        uncachedInputTokens: null,
      })
    },
  )

  it('preserves explicit zero reads and writes', () => {
    expect(
      readUserDraftUsage({
        ...base,
        provider: 'anthropic',
        step: {
          usage: { inputTokens: 1000, outputTokens: 200, totalTokens: 1200, cachedInputTokens: 0 },
          providerMetadata: { anthropic: { cacheCreationInputTokens: 0 } },
        },
      }),
    ).toMatchObject({
      inputTokens: 1000,
      cacheHitTokens: 0,
      cacheWriteTokens: 0,
      uncachedInputTokens: 1000,
    })
  })
})
