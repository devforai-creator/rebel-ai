import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText, jsonSchema, stepCountIs, tool } from 'ai'
import { buildLanguageModel } from './model-factory'
import { getProviderOptions } from './provider-options'
import { resolveInvocationSamplingOptions } from './invocation-sampling'
import { LLM_OUTPUT_LIMITS } from './output-limits'
import { estimateUsageCost } from '@/lib/model-pricing'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Gemini 4 Argon SDK request contract', () => {
  it.each(['low', 'medium', 'high'] as const)(
    'sends %s thinking through the installed SDK',
    async (effort) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          candidates: [
            { content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      await generateText({
        model: buildLanguageModel({
          provider: 'google',
          modelName: 'gemini-4-argon',
          apiKey: 'test-key',
        }),
        prompt: 'ok',
        providerOptions: getProviderOptions('google', {
          modelName: 'gemini-4-argon',
          reasoning: { effort, source: 'chat' },
        }),
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: effort })
    },
  )
  it('preserves tool thought signatures and bills implicit cache, output, and thinking separately', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: { name: 'fetch_source_range', args: {} },
                    thoughtSignature: 'argon-thought-signature',
                  },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10_000,
            candidatesTokenCount: 100,
            thoughtsTokenCount: 500,
            cachedContentTokenCount: 8_000,
            totalTokenCount: 10_600,
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'Hello' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10_100,
            candidatesTokenCount: 200,
            thoughtsTokenCount: 600,
            cachedContentTokenCount: 8_000,
            totalTokenCount: 10_900,
          },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const modelName = 'gemini-4-argon'
    const execute = vi.fn(async () => ({ messages: ['Earlier context'] }))
    const result = await generateText({
      model: buildLanguageModel({ provider: 'google', modelName, apiKey: 'test-key' }),
      system: 'Use prior conversation evidence.',
      prompt: 'Hello',
      maxOutputTokens: LLM_OUTPUT_LIMITS.chat,
      ...resolveInvocationSamplingOptions({ provider: 'google', modelName }),
      providerOptions: getProviderOptions('google', { modelName }),
      tools: {
        fetch_source_range: tool({
          description: 'Fetch prior conversation messages.',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
          execute,
        }),
      },
      stopWhen: stepCountIs(2),
    })

    expect(result.text).toBe('Hello')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-argon:generateContent',
      )
      const body = JSON.parse(init.body as string)
      expect(body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(32_768)
      expect(body.systemInstruction).toBeDefined()
      expect(body.tools[0].functionDeclarations[0].name).toBe('fetch_source_range')
      expect(body).not.toHaveProperty('cachedContent')
      expect(body.generationConfig).not.toHaveProperty('temperature')
      expect(body.generationConfig).not.toHaveProperty('topP')
      expect(body.generationConfig).not.toHaveProperty('topK')
    }
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondBody.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'model',
          parts: expect.arrayContaining([
            expect.objectContaining({ thoughtSignature: 'argon-thought-signature' }),
          ]),
        }),
      ]),
    )
    expect(result.totalUsage).toMatchObject({
      inputTokens: 20_100,
      outputTokens: 300,
      reasoningTokens: 1_100,
      cachedInputTokens: 16_000,
    })
    const cost = estimateUsageCost({
      provider: 'google',
      modelName,
      promptTokens: result.totalUsage.inputTokens,
      completionTokens: result.totalUsage.outputTokens,
      reasoningTokens: result.totalUsage.reasoningTokens,
      cachedInputTokens: result.totalUsage.cachedInputTokens,
    })
    expect(cost?.promptCost).toBeCloseTo(0.0082, 10)
    expect(cost?.cachedInputCost).toBeCloseTo(0.0016, 10)
    expect(cost?.completionCost).toBeCloseTo(0.003, 10)
    expect(cost?.reasoningCost).toBeCloseTo(0.011, 10)
    expect(cost?.totalCost).toBeCloseTo(0.0238, 10)
  })
})
