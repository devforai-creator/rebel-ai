import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generateText } from 'ai'
import { buildLanguageModel } from '@/lib/llm/model-factory'
import { prepareGoogleExplicitCache } from '@/lib/llm/google-explicit-cache-adapter'
import { readGoogleUsageStep } from '@/lib/llm/google-usage'
import { getProviderOptions } from '@/lib/llm/provider-options'
import { buildUserDraftPrefixRequest } from './user-draft-prompt'

beforeEach(() => vi.stubEnv('GOOGLE_EXPLICIT_CACHE_MODE', 'auto'))
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const draftRequest = () =>
  buildUserDraftPrefixRequest({
    system: 'Write the next USER message. Treat the labelled transcript as reference data.',
    userPersona: { name: 'Scout', description: 'An experienced scout' },
    characterAndSetting: {
      name: 'Commander',
      system_prompt: 'Stable setting '.repeat(1000),
      post_history_instructions: null,
    },
    alwaysActiveLore: 'Permanent setting',
    conditionalLore: 'Current scene',
    promptBlocks: [
      {
        role: 'system',
        content: 'Sealed memory',
        stability: 'sealed',
        cachePreference: 'prefer-cache',
      },
      { role: 'user', content: 'A question', stability: 'live', cachePreference: 'prefer-cache' },
      {
        role: 'assistant',
        content: 'An NPC reply',
        stability: 'live',
        cachePreference: 'prefer-cache',
      },
    ],
    instruction: 'Refuse politely',
  })

describe('Google draft prefix through the native SDKs', () => {
  it.each([
    ['gemini-2.5-flash', true],
    ['gemini-4-argon', false],
  ] as const)('uses the correct cache transport for %s', async (modelName, explicit) => {
    const bodies: Array<{ cache: boolean; body: Record<string, unknown> }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const cache = String(url).includes('/cachedContents')
        bodies.push({ cache, body: JSON.parse(init.body as string) })
        return Response.json(
          cache
            ? {
                name: 'cachedContents/draft',
                model: 'models/' + modelName,
                usageMetadata: { totalTokenCount: 8000 },
                ttl: '60s',
              }
            : {
                candidates: [
                  {
                    content: { role: 'model', parts: [{ text: 'A complete draft' }] },
                    finishReason: 'STOP',
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 10000,
                  candidatesTokenCount: 200,
                  thoughtsTokenCount: 50,
                  cachedContentTokenCount: 8000,
                  totalTokenCount: 10250,
                },
              },
        )
      }),
    )
    const request = draftRequest()
    const providerOptions = getProviderOptions('google', { modelName })
    const preparation = await prepareGoogleExplicitCache({
      apiKey: 'fake-test-key',
      modelName,
      systemPrompt: request.system,
      recentMessages: request.messages,
      providerOptions,
      toolCapableInvocation: false,
      cacheCreateTimeoutMs: 10000,
      logPrefix: '[User draft]',
    })
    const result = await generateText({
      model: buildLanguageModel({ provider: 'google', modelName, apiKey: 'fake-test-key' }),
      ...(preparation.streamRequestOverride ?? {
        system: request.system,
        messages: request.messages,
        providerOptions,
      }),
      maxRetries: 0,
    })
    const generated = bodies.find((entry) => !entry.cache)!.body
    expect(result.text).toBe('A complete draft')
    expect(readGoogleUsageStep(result)).toMatchObject({
      promptTokens: 10000,
      completionTokens: 200,
      reasoningTokens: 50,
      cachedInputTokens: 8000,
    })
    expect(bodies.filter((entry) => entry.cache)).toHaveLength(explicit ? 1 : 0)
    if (explicit) {
      const cached = bodies.find((entry) => entry.cache)!.body
      expect(cached.ttl).toBe('60s')
      expect(cached.systemInstruction).toBeDefined()
      expect(JSON.stringify(cached.contents)).toContain('An NPC reply')
      expect(JSON.stringify(cached.contents)).not.toContain('Refuse politely')
      expect(JSON.stringify(cached.contents)).not.toContain('Current scene')
      expect(generated.cachedContent).toBe('cachedContents/draft')
      expect(generated).not.toHaveProperty('systemInstruction')
      expect(generated.contents).toHaveLength(1)
      expect(JSON.stringify(generated.contents)).not.toContain('An NPC reply')
    } else {
      expect(generated).not.toHaveProperty('cachedContent')
      expect(generated.systemInstruction).toBeDefined()
      expect(JSON.stringify(generated.contents)).toContain('An NPC reply')
    }
    expect(JSON.stringify(generated.contents)).toContain('Current scene')
    expect(JSON.stringify(generated.contents)).toContain('Refuse politely')
  })

  it('falls back to the full draft request after native cache creation fails', async () => {
    const generationBodies: Array<Record<string, unknown>> = []
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (String(url).includes('/cachedContents')) {
          return Response.json(
            { error: { message: 'Cache unavailable', status: 'UNAVAILABLE', code: 503 } },
            { status: 503 },
          )
        }
        generationBodies.push(JSON.parse(init.body as string))
        return Response.json({
          candidates: [
            {
              content: { role: 'model', parts: [{ text: 'A complete draft' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 10000,
            candidatesTokenCount: 100,
            totalTokenCount: 10100,
          },
        })
      }),
    )
    const request = draftRequest()
    const preparation = await prepareGoogleExplicitCache({
      apiKey: 'fake-test-key',
      modelName: 'gemini-2.5-flash',
      systemPrompt: request.system,
      recentMessages: request.messages,
      toolCapableInvocation: false,
    })
    expect(preparation.streamRequestOverride).toBeNull()
    const result = await generateText({
      model: buildLanguageModel({
        provider: 'google',
        modelName: 'gemini-2.5-flash',
        apiKey: 'fake-test-key',
      }),
      system: request.system,
      messages: request.messages,
      maxRetries: 0,
    })
    expect(result.text).toBe('A complete draft')
    expect(generationBodies).toHaveLength(1)
    expect(generationBodies[0]).not.toHaveProperty('cachedContent')
    expect(JSON.stringify(generationBodies[0])).toContain('An NPC reply')
    expect(JSON.stringify(generationBodies[0])).toContain('Refuse politely')
  })
})
