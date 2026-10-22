import { describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import {
  buildGooglePrefixCacheContextRequest,
  prepareGoogleExplicitCache,
} from '@/lib/llm/google-explicit-cache-adapter'
import { readGoogleUsageStep } from '@/lib/llm/google-usage'

describe('Google Prefix explicit cache on the installed SDK wire', () => {
  it('sends memory and lore only to cache creation, and execution guidance only to generation', async () => {
    const cacheBodies: Array<Record<string, unknown>> = []
    const generationBodies: Array<Record<string, unknown>> = []
    const memory = 'SEALED SUMMARY AND FACTS '.repeat(1500)
    const messages = [
      { role: 'user' as const, content: 'Old question' },
      { role: 'assistant' as const, content: 'Old answer' },
      { role: 'user' as const, content: 'Current question' },
    ]
    const original = structuredClone(messages)
    vi.stubEnv('GOOGLE_EXPLICIT_CACHE_MODE', 'auto')
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain('/cachedContents')
      cacheBodies.push(JSON.parse(String(init?.body)))
      return Response.json({
        name: 'cachedContents/prefix-test',
        usageMetadata: { totalTokenCount: 9000 },
        ttl: '60s',
      })
    })
    const google = createGoogleGenerativeAI({
      apiKey: 'test-key',
      fetch: async (_input, init) => {
        generationBodies.push(JSON.parse(String(init?.body)))
        return Response.json({
          candidates: [
            { content: { role: 'model', parts: [{ text: 'A reply' }] }, finishReason: 'STOP' },
          ],
          usageMetadata: {
            promptTokenCount: 9100,
            cachedContentTokenCount: 9000,
            candidatesTokenCount: 20,
            totalTokenCount: 9120,
          },
        })
      },
    })
    try {
      const request = buildGooglePrefixCacheContextRequest({
        context: { instructions: 'FIXED CARD', memory, turnContext: 'CURRENT CONDITIONAL LORE' },
        messages,
        toolInstruction: 'CURRENT ATR EXECUTION GUIDANCE',
      })
      const cache = await prepareGoogleExplicitCache({
        apiKey: 'test-key',
        modelName: 'gemini-3.8-flash',
        systemPrompt: request.system,
        recentMessages: request.messages,
        toolCapableInvocation: false,
      })
      expect(cache.streamRequestOverride).not.toBeNull()
      const result = await generateText({
        model: google('gemini-3.8-flash'),
        ...cache.streamRequestOverride!,
        maxRetries: 0,
      })
      expect(cacheBodies).toHaveLength(1)
      const cachedContents = cacheBodies[0].contents as Array<{
        role: string
        parts: Array<{ text: string }>
      }>
      expect(
        cachedContents.slice(0, 3).map(({ role, parts }) => ({ role, text: parts[0].text })),
      ).toEqual([
        { role: 'user', text: 'Old question' },
        { role: 'model', text: 'Old answer' },
        { role: 'user', text: 'Current question' },
      ])
      expect(cachedContents.at(-1)?.parts[0].text).toContain(
        `${memory}\n\nCURRENT CONDITIONAL LORE`,
      )
      expect(JSON.stringify(cacheBodies[0])).not.toContain('CURRENT ATR EXECUTION GUIDANCE')
      expect(generationBodies).toHaveLength(1)
      expect(generationBodies[0].cachedContent).toBe('cachedContents/prefix-test')
      expect(generationBodies[0]).not.toHaveProperty('systemInstruction')
      expect(generationBodies[0].contents).toEqual([
        {
          role: 'user',
          parts: [
            {
              text: '<application_context>\nCURRENT ATR EXECUTION GUIDANCE\n</application_context>',
            },
          ],
        },
      ])
      expect(readGoogleUsageStep(result)).toMatchObject({
        promptTokens: 9100,
        cachedInputTokens: 9000,
      })
      expect(messages).toEqual(original)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})
