import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { buildLanguageModel } from './model-factory'
import { getProviderOptions } from './provider-options'
import { resolveInvocationSamplingOptions } from './invocation-sampling'
import { supportsRequiredToolChoice } from '@/lib/models'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Claude 5.5 SDK request contracts', () => {
  it.each(['claude-sonnet-5-5', 'claude-haiku-5-5'])(
    'sends a supported request and parses usage for %s',
    async (modelName) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: modelName,
          content: [{ type: 'text', text: 'Hello' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: {
            input_tokens: 1_000,
            output_tokens: 100,
            cache_read_input_tokens: 50_000,
            cache_creation_input_tokens: 49_001,
          },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)

      const model = buildLanguageModel({
        provider: 'anthropic',
        modelName,
        apiKey: 'test-key',
      }) as LanguageModelV2
      const result = await model.doGenerate({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
        maxOutputTokens: 4_096,
        ...resolveInvocationSamplingOptions({ provider: 'anthropic', modelName }),
        tools: [
          {
            type: 'function',
            name: 'fetch_source_range',
            description: 'Fetch prior conversation messages.',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        toolChoice: {
          type: supportsRequiredToolChoice({ provider: 'anthropic', modelName })
            ? 'required'
            : 'auto',
        },
        providerOptions: getProviderOptions('anthropic', { modelName }),
      })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toBe('https://api.anthropic.com/v1/messages')
      const body = JSON.parse(init.body as string)
      expect(body).toMatchObject({
        model: modelName,
        tools: [{ name: 'fetch_source_range' }],
        tool_choice: { type: modelName === 'claude-sonnet-5-5' ? 'auto' : 'any' },
      })
      expect(body).not.toHaveProperty('thinking')
      expect(body).not.toHaveProperty('temperature')
      expect(body).not.toHaveProperty('top_p')
      expect(body).not.toHaveProperty('top_k')
      expect(result.usage).toMatchObject({
        inputTokens: 1_000,
        outputTokens: 100,
        cachedInputTokens: 50_000,
      })
      expect(result.providerMetadata?.anthropic?.cacheCreationInputTokens).toBe(49_001)
    },
  )
})
