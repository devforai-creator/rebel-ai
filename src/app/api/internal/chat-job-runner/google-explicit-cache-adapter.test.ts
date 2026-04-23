import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'

const createGoogleCacheMock = vi.fn()
const resolveGoogleCacheDecisionMock = vi.fn()
const isGoogleExplicitCacheEnabledMock = vi.fn()

vi.mock('@/lib/llm/google-cache', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/llm/google-cache')>('@/lib/llm/google-cache')

  return {
    ...actual,
    createGoogleCache: (...args: unknown[]) => createGoogleCacheMock(...args),
    resolveGoogleCacheDecision: (...args: unknown[]) => resolveGoogleCacheDecisionMock(...args),
    isGoogleExplicitCacheEnabled: (...args: unknown[]) => isGoogleExplicitCacheEnabledMock(...args),
  }
})

describe('prepareGoogleExplicitCache', () => {
  beforeEach(() => {
    createGoogleCacheMock.mockReset()
    resolveGoogleCacheDecisionMock.mockReset()
    isGoogleExplicitCacheEnabledMock.mockReset()

    resolveGoogleCacheDecisionMock.mockReturnValue({ enabled: false, minTokens: null })
    isGoogleExplicitCacheEnabledMock.mockReturnValue(true)
  })

  it('creates a cached stream-request override when explicit cache succeeds', async () => {
    const { prepareGoogleExplicitCache } = await import('./google-explicit-cache-adapter')
    const providerOptions: SharedV2ProviderOptions = {
      google: { safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }] },
    }

    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    createGoogleCacheMock.mockResolvedValueOnce({
      success: true,
      cacheName: 'cache-1',
      cachedTokenCount: 2048,
    })

    const result = await prepareGoogleExplicitCache({
      apiKey: 'sk-test',
      modelName: 'gemini-2.5-flash',
      systemPrompt: 'FINAL',
      recentMessages: [
        { role: 'assistant', content: 'Older context' },
        { role: 'user', content: 'Last message' },
      ],
      providerOptions,
      toolCapableInvocation: false,
      jobId: 'job-google',
      timings: {},
    })

    expect(createGoogleCacheMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      modelName: 'gemini-2.5-flash',
      systemPrompt: 'FINAL',
      messagesToCache: [{ role: 'assistant', content: 'Older context' }],
      toolContract: null,
      ttlSeconds: 20,
    })
    expect(result).toMatchObject({
      googleExplicitCacheEnabled: true,
      googleCacheDecision: { enabled: true, minTokens: 1024 },
      googleCacheResult: {
        success: true,
        cacheName: 'cache-1',
        cachedTokenCount: 2048,
      },
      disabledForToolUsePreflight: false,
      disabledForCompatibilityRetry: false,
      requestContract: {
        canonicalRequest: {
          systemPrompt: 'FINAL',
          messages: [
            { role: 'assistant', content: 'Older context' },
            { role: 'user', content: 'Last message' },
          ],
          providerOptions: {
            google: {
              safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
            },
          },
          toolContract: null,
        },
        cacheCreateInput: {
          systemPrompt: 'FINAL',
          messagesToCache: [{ role: 'assistant', content: 'Older context' }],
          toolContract: null,
        },
        liveRequestTail: {
          messages: [{ role: 'user', content: 'Last message' }],
          providerOptions: {
            google: {
              safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
            },
          },
          toolContract: null,
        },
      },
      streamRequestOverride: {
        messages: [{ role: 'user', content: 'Last message' }],
        providerOptions: {
          google: {
            cachedContent: 'cache-1',
            safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
          },
        },
      },
      cacheDebugInfo: {
        systemPrompt: 'FINAL',
        cacheName: 'cache-1',
        cachedTokenCount: 2048,
        messagesToCache: [{ role: 'assistant', content: 'Older context' }],
      },
    })
  })

  it('disables explicit cache before request build when a tool-capable invocation lacks a cacheable tool contract', async () => {
    const { prepareGoogleExplicitCache } = await import('./google-explicit-cache-adapter')

    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })

    const result = await prepareGoogleExplicitCache({
      apiKey: 'sk-test',
      modelName: 'gemini-2.5-flash',
      systemPrompt: 'FINAL',
      recentMessages: [
        { role: 'assistant', content: 'Older context' },
        { role: 'user', content: 'Last message' },
      ],
      providerOptions: undefined,
      toolCapableInvocation: true,
      jobId: 'job-google-tools',
      timings: {},
    })

    expect(createGoogleCacheMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      googleExplicitCacheEnabled: false,
      googleCacheDecision: { enabled: true, minTokens: 1024 },
      googleCacheResult: null,
      disabledForToolUsePreflight: true,
      disabledForCompatibilityRetry: false,
      requestContract: {
        cacheCreateInput: {
          toolContract: null,
        },
        liveRequestTail: {
          toolContract: null,
        },
      },
      streamRequestOverride: null,
      cacheDebugInfo: null,
    })
  })

  it('disables explicit cache when compatibility retry forces uncached behavior', async () => {
    const { prepareGoogleExplicitCache } = await import('./google-explicit-cache-adapter')

    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })

    const result = await prepareGoogleExplicitCache({
      apiKey: 'sk-test',
      modelName: 'gemini-2.5-flash',
      systemPrompt: 'FINAL',
      recentMessages: [
        { role: 'assistant', content: 'Older context' },
        { role: 'user', content: 'Last message' },
      ],
      providerOptions: undefined,
      toolCapableInvocation: false,
      disableGoogleExplicitCache: true,
      jobId: 'job-google-retry',
      timings: {},
    })

    expect(createGoogleCacheMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      googleExplicitCacheEnabled: false,
      googleCacheDecision: { enabled: true, minTokens: 1024 },
      googleCacheResult: null,
      disabledForToolUsePreflight: false,
      disabledForCompatibilityRetry: true,
      requestContract: {
        cacheCreateInput: {
          toolContract: null,
        },
        liveRequestTail: {
          toolContract: null,
        },
      },
      streamRequestOverride: null,
      cacheDebugInfo: null,
    })
  })

  it('uses explicit cache for tool-capable turns once a cacheable tool contract exists', async () => {
    const { prepareGoogleExplicitCache } = await import('./google-explicit-cache-adapter')

    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    createGoogleCacheMock.mockResolvedValueOnce({
      success: true,
      cacheName: 'cache-tools-1',
      cachedTokenCount: 4096,
    })

    const result = await prepareGoogleExplicitCache({
      apiKey: 'sk-test',
      modelName: 'gemini-2.5-flash',
      systemPrompt: 'FINAL\n\nExperimental',
      recentMessages: [
        { role: 'assistant', content: 'Older context' },
        { role: 'user', content: 'Last message' },
      ],
      providerOptions: undefined,
      toolContract: {
        tools: [
          {
            name: 'fetch_source_range',
            description: 'Fetch older transcript evidence.',
            inputSchema: {
              type: 'object',
              properties: {
                startSeq: { type: 'integer' },
              },
              required: ['startSeq'],
            },
          },
        ],
        toolChoice: { type: 'required' },
      },
      toolCapableInvocation: true,
      jobId: 'job-google-tools-contract',
      timings: {},
    })

    expect(createGoogleCacheMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        modelName: 'gemini-2.5-flash',
        systemPrompt: 'FINAL\n\nExperimental',
        messagesToCache: [{ role: 'assistant', content: 'Older context' }],
        toolContract: expect.objectContaining({
          tools: expect.arrayContaining([expect.objectContaining({ name: 'fetch_source_range' })]),
          toolChoice: { type: 'auto' },
        }),
        ttlSeconds: 20,
      }),
    )
    expect(result).toMatchObject({
      googleExplicitCacheEnabled: true,
      googleCacheResult: {
        success: true,
        cacheName: 'cache-tools-1',
        cachedTokenCount: 4096,
      },
      disabledForToolUsePreflight: false,
      streamRequestOverride: {
        messages: [{ role: 'user', content: 'Last message' }],
        providerOptions: {
          google: {
            cachedContent: 'cache-tools-1',
            rebelCachedContentOwnsRequestContract: true,
          },
        },
      },
      requestContract: {
        canonicalRequest: {
          toolContract: {
            tools: [{ name: 'fetch_source_range' }],
            toolChoice: { type: 'required' },
          },
        },
        cacheCreateInput: {
          toolContract: {
            tools: [{ name: 'fetch_source_range' }],
            toolChoice: { type: 'auto' },
          },
        },
        liveRequestTail: {
          toolContract: {
            tools: [{ name: 'fetch_source_range' }],
            toolChoice: { type: 'required' },
          },
        },
      },
    })
  })
})
