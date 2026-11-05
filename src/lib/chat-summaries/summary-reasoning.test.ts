import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai'
import { buildLanguageModel } from '@/lib/llm/model-factory'
import { getProviderOptions } from '@/lib/llm/provider-options'
import { withSummaryReasoning } from './summary-reasoning'

afterEach(() => vi.unstubAllGlobals())

describe('independent summary reasoning', () => {
  it.each(['none', 'low', 'high', 'max'] as const)(
    'overrides a conflicting chat preference with DeepSeek summary preference %s',
    async (preference) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          id: 'summary-completion',
          created: 1,
          model: 'deepseek-v4-flash',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'summary' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const model = withSummaryReasoning({
        model: buildLanguageModel({
          provider: 'deepseek',
          modelName: 'deepseek-v4-flash',
          apiKey: 'test-key',
        }),
        provider: 'deepseek',
        modelName: 'deepseek-v4-flash',
        preference,
      })
      const { text } = await generateText({
        model,
        prompt: 'Summarize this conversation',
        providerOptions: {
          deepseek: {
            thinking: { type: 'enabled' },
            reasoningEffort: 'high',
            userId: 'summary-user',
          },
        },
      })
      expect(text).toBe('summary')
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.user_id).toBe('summary-user')
      expect(body.thinking).toEqual({ type: preference === 'none' ? 'disabled' : 'enabled' })
      expect(body.reasoning_effort).toBe(preference === 'none' ? undefined : preference)
    },
  )

  it('preserves OpenAI cache and service tier while overriding chat reasoning', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: 'resp-summary',
        object: 'response',
        created_at: 1,
        model: 'gpt-5.5',
        status: 'completed',
        output: [
          {
            type: 'message',
            id: 'msg-summary',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text: 'summary', annotations: [] }],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await generateText({
      model: withSummaryReasoning({
        model: buildLanguageModel({ provider: 'openai', modelName: 'gpt-5.5', apiKey: 'test-key' }),
        provider: 'openai',
        modelName: 'gpt-5.5',
        preference: 'low',
      }),
      prompt: 'Summarize',
      providerOptions: getProviderOptions('openai', {
        modelName: 'gpt-5.5',
        serviceTier: 'flex',
        promptCacheKey: 'summary-cache',
        reasoning: { effort: 'high', source: 'chat' },
      }),
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.reasoning.effort).toBe('low')
    expect(body.service_tier).toBe('flex')
    expect(body.prompt_cache_key).toBe('summary-cache')
    expect(body.prompt_cache_retention).toBe('24h')
  })

  it('uses the Google summary preference instead of the chat preference', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        candidates: [
          { content: { role: 'model', parts: [{ text: 'summary' }] }, finishReason: 'STOP' },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await generateText({
      model: withSummaryReasoning({
        model: buildLanguageModel({
          provider: 'google',
          modelName: 'gemini-4-argon',
          apiKey: 'test-key',
        }),
        provider: 'google',
        modelName: 'gemini-4-argon',
        preference: 'low',
      }),
      prompt: 'Summarize',
      providerOptions: getProviderOptions('google', {
        modelName: 'gemini-4-argon',
        reasoning: { effort: 'high', source: 'chat' },
        serviceTier: 'flex',
      }),
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    expect(body.serviceTier).toBe('flex')
  })

  it.each([undefined, null, 'default', 'medium', 'xhigh', 'invalid'])(
    'preserves default model behavior for missing or unsupported DeepSeek preference %s',
    (preference) => {
      const model = buildLanguageModel({
        provider: 'deepseek',
        modelName: 'deepseek-v4-pro',
        apiKey: 'test-key',
      })
      expect(
        withSummaryReasoning({
          model,
          provider: 'deepseek',
          modelName: 'deepseek-v4-pro',
          preference,
        }),
      ).toBe(model)
    },
  )
})
