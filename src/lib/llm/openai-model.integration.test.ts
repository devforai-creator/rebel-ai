import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { getProviderOptions } from './provider-options'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GPT-6.1 Sol SDK request contract', () => {
  it('uses Responses with supported reasoning, tool calling, and cache-write metadata', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'resp_test',
        created_at: 0,
        model: 'gpt-6.1-sol',
        status: 'completed',
        output: [
          {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'Hello', annotations: [] }],
          },
        ],
        usage: {
          input_tokens: 10000,
          input_tokens_details: { cached_tokens: 8000, cache_write_tokens: 1000 },
          output_tokens: 1500,
          output_tokens_details: { reasoning_tokens: 500 },
          total_tokens: 11500,
        },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    vi.resetModules()
    const { buildLanguageModel } = await import('./model-factory')

    const model = buildLanguageModel({
      provider: 'openai',
      modelName: 'gpt-6.1-sol',
      apiKey: 'test-key',
      serviceTier: 'flex',
    }) as LanguageModelV2
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
      temperature: 0.8,
      topP: 0.9,
      tools: [
        {
          type: 'function',
          name: 'fetch_source_range',
          description: 'Fetch prior conversation messages.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
      providerOptions: getProviderOptions('openai', {
        modelName: 'gpt-6.1-sol',
        promptCacheKey: 'cache-key',
        reasoningEffort: 'none',
      }),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/responses')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      model: 'gpt-6.1-sol',
      reasoning: { effort: 'low' },
      service_tier: 'flex',
      prompt_cache_key: 'cache-key',
      tools: [{ type: 'function', name: 'fetch_source_range' }],
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
    expect(body).not.toHaveProperty('prompt_cache_retention')
    expect(result.providerMetadata?.openai?.usage).toMatchObject({ cacheWriteTokens: 1000 })
    expect(result.usage).toMatchObject({
      inputTokens: 10000,
      outputTokens: 1500,
      reasoningTokens: 500,
      cachedInputTokens: 8000,
    })
  })
})
