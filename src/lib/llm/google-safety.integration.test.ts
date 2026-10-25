import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateText, streamText } from 'ai'
import { buildLanguageModel } from './model-factory'
import { getProviderOptions } from './provider-options'

afterEach(() => vi.unstubAllGlobals())

describe('Google safety settings SDK request contract', () => {
  it.each(['generate', 'stream'] as const)('sends explicit OFF filters for %s', async (mode) => {
    for (const modelName of ['gemini-2.5-flash', 'gemini-4-argon']) {
      const cached = modelName === 'gemini-2.5-flash'
      const response = {
        candidates: [{ content: { role: 'model', parts: [{ text: 'ok' }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 1, totalTokenCount: 11 },
      }
      const fetchMock = vi.fn().mockResolvedValue(
        mode === 'stream'
          ? new Response(`data: ${JSON.stringify(response)}\n\n`, {
              headers: { 'content-type': 'text/event-stream' },
            })
          : Response.json(response),
      )
      vi.stubGlobal('fetch', fetchMock)
      const providerOptions = getProviderOptions('google', {
        serviceTier: 'flex',
        modelName,
        reasoning: { effort: 'low', source: 'chat' },
      })!
      if (cached) providerOptions.google.cachedContent = 'cachedContents/safety-test'
      const options = {
        model: buildLanguageModel({ provider: 'google', modelName, apiKey: 'test-key' }),
        prompt: 'Hello',
        providerOptions,
        maxRetries: 0,
      }
      const result = mode === 'stream' ? streamText(options) : await generateText(options)

      expect(await result.text).toBe('ok')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(url).toContain(
        `models/${modelName}:${mode === 'stream' ? 'streamGenerateContent' : 'generateContent'}`,
      )
      const body = JSON.parse(init.body as string)
      expect(body.safetySettings).toEqual([
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'OFF' },
        { category: 'HARM_CATEGORY_JAILBREAK', threshold: 'OFF' },
      ])
      expect(body.generationConfig).not.toHaveProperty('safetySettings')
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
      expect(body.serviceTier).toBe('flex')
      if (cached) expect(body.cachedContent).toBe('cachedContents/safety-test')
    }
  })
})
