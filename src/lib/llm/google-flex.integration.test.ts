import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModelV2 } from '@ai-sdk/provider'
import { streamText } from 'ai'
import { buildLanguageModel } from './model-factory'
import { getProviderOptions } from './provider-options'
import { estimateUsageCost } from '@/lib/model-pricing'

afterEach(() => vi.unstubAllGlobals())
const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }]

describe('Google Flex SDK contract', () => {
  it.each(['standard', 'flex'] as const)(
    'sends %s at the request root and reads the returned tier',
    async (serviceTier) => {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          candidates: [
            { content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' },
          ],
          usageMetadata: {
            promptTokenCount: 10000,
            candidatesTokenCount: 1500,
            thoughtsTokenCount: 500,
            cachedContentTokenCount: 8000,
            totalTokenCount: 12000,
            serviceTier,
          },
        }),
      )
      vi.stubGlobal('fetch', fetchMock)
      const model = buildLanguageModel({
        provider: 'google',
        modelName: 'gemini-4-argon',
        apiKey: 'test-key',
      }) as LanguageModelV2
      const result = await model.doGenerate({
        prompt,
        providerOptions: getProviderOptions('google', {
          serviceTier,
          reasoning: { effort: 'low', source: 'chat' },
        }),
      })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.serviceTier).toBe(serviceTier)
      expect(body.generationConfig.thinkingConfig.thinkingLevel).toBe('low')
      expect(body.generationConfig.serviceTier).toBeUndefined()
      expect(result.providerMetadata?.google?.serviceTier).toBe(serviceTier)
      expect(result.usage).toMatchObject({
        inputTokens: 10000,
        outputTokens: 1500,
        reasoningTokens: 500,
        cachedInputTokens: 8000,
      })
    },
  )

  it.each(['root', 'usage'] as const)(
    'retains the actual tier from a streaming response (%s)',
    async (location) => {
      const chunk = {
        candidates: [
          { content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' },
        ],
        ...(location === 'root' ? { serviceTier: 'flex' } : {}),
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 1,
          totalTokenCount: 11,
          ...(location === 'usage' ? { serviceTier: 'flex' } : {}),
        },
      }
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
            headers: { 'content-type': 'text/event-stream' },
          }),
        ),
      )
      const result = streamText({
        model: buildLanguageModel({
          provider: 'google',
          modelName: 'gemini-4-argon',
          apiKey: 'test-key',
        }),
        prompt: 'Hello',
        providerOptions: getProviderOptions('google', { serviceTier: 'flex' }),
        maxRetries: 0,
      })
      for await (const part of result.fullStream) expect(part.type).not.toBe('raw')
      expect((await result.providerMetadata)?.google?.serviceTier).toBe('flex')
    },
  )

  it('does not send a Standard request after Flex capacity failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 503, message: 'Flex capacity unavailable', status: 'UNAVAILABLE' } },
          { status: 503 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const model = buildLanguageModel({
      provider: 'google',
      modelName: 'gemini-4-argon',
      apiKey: 'test-key',
    }) as LanguageModelV2
    await expect(
      model.doGenerate({
        prompt,
        providerOptions: getProviderOptions('google', { serviceTier: 'flex' }),
      }),
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).serviceTier).toBe('flex')
  })

  it('halves uncached input, cached input, visible output, and reasoning charges', () => {
    const params = {
      provider: 'google' as const,
      pricingTimestamp: '2026-10-16T00:00:00Z',
      modelName: 'gemini-4-argon',
      promptTokens: 10000,
      cachedInputTokens: 8000,
      completionTokens: 1500,
      reasoningTokens: 500,
    }
    const standard = estimateUsageCost({ ...params, serviceTier: 'standard' })!
    const flex = estimateUsageCost({ ...params, serviceTier: 'flex' })!
    for (const field of [
      'promptCost',
      'cachedInputCost',
      'completionCost',
      'reasoningCost',
      'totalCost',
    ] as const)
      expect(flex[field]).toBeCloseTo(standard[field] / 2)
  })
})
