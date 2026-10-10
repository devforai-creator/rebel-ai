import { describe, expect, it } from 'vitest'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'

import { buildStreamPayloadPlan } from './stream-payload-builder'

const BASE_ARGS = {
  promptBlocks: [] as Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
    cachePreference: 'prefer-cache' | 'no-preference' | 'avoid-cache'
    stability: 'static' | 'sealed' | 'live'
  }>,
  recentMessages: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  googleExplicitCache: null,
}

describe('buildStreamPayloadPlan', () => {
  it('caches only the static system prompt in the summary-window payload', () => {
    const providerOptions: SharedV2ProviderOptions = {
      anthropic: { version: '2025-01-01' },
    }

    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: 'SUMMARIES_FACTS',
      anthropicCache: { enabled: true, ttl: '5m', minTokens: 2048 },
      promptBlocks: [
        {
          role: 'system',
          content: 'STATIC',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'system',
          content: 'SUMMARIES_FACTS',
          cachePreference: 'avoid-cache',
          stability: 'sealed',
        },
        {
          role: 'user',
          content: 'hello',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
        {
          role: 'assistant',
          content: 'hi',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
      ],
      anthropicConversationMessages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
      providerOptions,
    })

    expect(result.strategy).toBe('anthropic-split-system')
    expect(result.streamRequest.system).toBeUndefined()
    expect(result.streamRequest.providerOptions).toEqual({
      anthropic: {
        version: '2025-01-01',
      },
    })

    // 2 system messages + 2 conversation = 4 total
    expect(result.streamRequest.messages).toHaveLength(4)

    // System 1: static
    expect(result.streamRequest.messages[0]).toMatchObject({
      role: 'system',
      content: 'STATIC',
    })
    expect(result.streamRequest.messages[0]).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })

    // System 2: summaries+facts
    expect(result.streamRequest.messages[1]).toMatchObject({
      role: 'system',
      content: 'SUMMARIES_FACTS',
    })
    expect(result.streamRequest.messages[1]).not.toHaveProperty('providerOptions')

    expect(result.actualPayload).toMatchObject({
      provider: 'anthropic',
      strategy: 'anthropic-split-system',
      systemMessages: [
        { role: 'system', content: 'STATIC', cached: true },
        { role: 'system', content: 'SUMMARIES_FACTS' },
      ],
      conversationMessages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    })
  })

  it('omits the dynamic system message when there is no dynamic context', () => {
    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: null,
      anthropicCache: { enabled: true, ttl: '5m', minTokens: 1024 },
      promptBlocks: [
        {
          role: 'system',
          content: 'STATIC',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'user',
          content: 'hello',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
      ],
      anthropicConversationMessages: [{ role: 'user', content: 'hello' }],
    })

    // 1 system message + 1 conversation = 2
    expect(result.streamRequest.messages).toHaveLength(2)
    expect(result.streamRequest.messages[0]).toMatchObject({
      role: 'system',
      content: 'STATIC',
    })
    expect(result.streamRequest.messages[0]).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
    expect(result.streamRequest.providerOptions).toBeUndefined()
    expect(result.actualPayload.systemMessages).toEqual([
      { role: 'system', content: 'STATIC', cached: true },
    ])
  })

  it('no cache applied when anthropicCache is null', () => {
    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: null,
      anthropicCache: null,
      promptBlocks: [
        {
          role: 'system',
          content: 'STATIC',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'user',
          content: 'hello',
          cachePreference: 'avoid-cache',
          stability: 'live',
        },
      ],
      anthropicConversationMessages: [{ role: 'user', content: 'hello' }],
    })

    // 1 system message (no cache) + 1 conversation = 2
    expect(result.streamRequest.messages).toHaveLength(2)
    expect(result.streamRequest.messages[0]).not.toHaveProperty('providerOptions')
  })

  it('builds google explicit cache payload when cache is available', () => {
    const providerOptions: SharedV2ProviderOptions = {
      google: { safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }] },
    }

    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'google',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: null,
      anthropicCache: null,
      anthropicConversationMessages: [],
      recentMessages: [
        { role: 'user', content: 'old message' },
        { role: 'assistant', content: 'last response' },
      ],
      googleExplicitCache: {
        googleExplicitCacheEnabled: true,
        googleCacheDecision: { enabled: true, minTokens: 1024 },
        googleCacheResult: {
          success: true,
          cacheName: 'cache-name',
          cachedTokenCount: 400,
          ttl: '20s',
          expireTime: '2026-02-10T00:00:00.000Z',
        },
        disabledForToolUsePreflight: false,
        disabledForCompatibilityRetry: false,
        requestContract: {
          canonicalRequest: {
            systemPrompt: 'FINAL',
            messages: [
              { role: 'user', content: 'old message' },
              { role: 'assistant', content: 'last response' },
            ],
            providerOptions,
            toolContract: null,
          },
          cacheCreateInput: {
            systemPrompt: 'FINAL',
            messagesToCache: [{ role: 'user', content: 'old message' }],
            toolContract: null,
          },
          liveRequestTail: {
            messages: [{ role: 'assistant', content: 'last response' }],
            providerOptions,
            toolContract: null,
          },
        },
        streamRequestOverride: {
          messages: [{ role: 'assistant', content: 'last response' }],
          providerOptions: {
            google: {
              cachedContent: 'cache-name',
              safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
            },
          },
        },
        cacheDebugInfo: {
          systemPrompt: 'FINAL',
          cacheName: 'cache-name',
          cachedTokenCount: 400,
          messagesToCache: [{ role: 'user', content: 'old message' }],
        },
      },
      providerOptions,
    })

    expect(result.strategy).toBe('google-explicit-cache')
    expect(result.streamRequest.system).toBeUndefined()
    expect(result.streamRequest.messages).toEqual([{ role: 'assistant', content: 'last response' }])
    expect(result.streamRequest.providerOptions).toMatchObject({
      google: {
        cachedContent: 'cache-name',
        safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }],
      },
    })
    expect(result.actualPayload).toMatchObject({
      provider: 'google',
      strategy: 'google-explicit-cache',
      systemMessages: [{ role: 'system', content: 'FINAL' }],
      conversationMessages: [
        { role: 'user', content: 'old message' },
        { role: 'assistant', content: 'last response' },
      ],
      cache: {
        systemPrompt: 'FINAL',
        cacheName: 'cache-name',
        cachedTokenCount: 400,
        messagesToCache: [{ role: 'user', content: 'old message' }],
      },
    })
  })

  it('falls back to default payload when explicit cache is unavailable', () => {
    const providerOptions: SharedV2ProviderOptions = {
      openai: { promptCacheKey: 'ctx:key', promptCacheRetention: '24h' },
    }

    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'openai',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: null,
      anthropicCache: null,
      anthropicConversationMessages: [],
      recentMessages: [{ role: 'user', content: 'recent user' }],
      googleExplicitCache: null,
      providerOptions,
    })

    expect(result.strategy).toBe('default')
    expect(result.streamRequest.system).toBe('FINAL')
    expect(result.streamRequest.messages).toEqual([{ role: 'user', content: 'recent user' }])
    expect(result.streamRequest.providerOptions).toEqual(providerOptions)
  })

  it('builds the standard google payload when explicit cache is unavailable', () => {
    const providerOptions: SharedV2ProviderOptions = {
      google: { safetySettings: [{ category: 'HARM', threshold: 'BLOCK_NONE' }] },
    }

    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'google',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: null,
      anthropicCache: null,
      anthropicConversationMessages: [],
      recentMessages: [
        { role: 'assistant', content: 'Older context' },
        { role: 'user', content: 'Last message' },
      ],
      googleExplicitCache: null,
      providerOptions,
    })

    expect(result).toMatchObject({
      strategy: 'default',
      streamRequest: {
        system: 'FINAL',
        messages: [
          { role: 'assistant', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
        providerOptions,
      },
      actualPayload: {
        provider: 'google',
        strategy: 'default',
        systemMessages: [{ role: 'system', content: 'FINAL' }],
        conversationMessages: [
          { role: 'assistant', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
      },
    })
  })

  it('excludes sealed memory and live conversation from caching in prefix mode', () => {
    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'STATIC\n\nSEALED',
      staticSystemPrompt: 'STATIC',
      dynamicContext: 'SEALED',
      anthropicCache: { enabled: true, ttl: '5m', minTokens: 1024 },
      promptBlocks: [
        {
          role: 'system',
          content: 'STATIC',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'system',
          content: 'SEALED',
          cachePreference: 'prefer-cache',
          stability: 'sealed',
        },
        {
          role: 'user',
          content: 'older live',
          cachePreference: 'prefer-cache',
          stability: 'live',
        },
        {
          role: 'assistant',
          content: 'older reply',
          cachePreference: 'prefer-cache',
          stability: 'live',
        },
        {
          role: 'user',
          content: 'latest user',
          cachePreference: 'prefer-cache',
          stability: 'live',
        },
      ],
      anthropicConversationMessages: [
        { role: 'user', content: 'older live' },
        { role: 'assistant', content: 'older reply' },
        { role: 'user', content: 'latest user' },
      ],
    })

    expect(result.streamRequest.messages).toHaveLength(5)
    expect(result.streamRequest.messages[0]).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
    expect(result.streamRequest.messages[1]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.messages[4]).toMatchObject({
      role: 'user',
      content: 'latest user',
    })
    expect(result.streamRequest.messages[4]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.providerOptions).toBeUndefined()
    expect(result.actualPayload.conversationMessages).toEqual([
      { role: 'user', content: 'older live' },
      { role: 'assistant', content: 'older reply' },
      { role: 'user', content: 'latest user' },
    ])
  })

  it('keeps the single breakpoint before sealed memory and dynamic lorebook', () => {
    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'STATIC\n\nSEALED\n\nLOREBOOK',
      staticSystemPrompt: 'STATIC',
      dynamicContext: 'SEALED\n\nLOREBOOK',
      anthropicCache: { enabled: true, ttl: '5m', minTokens: 1024 },
      promptBlocks: [
        {
          role: 'system',
          content: 'STATIC',
          cachePreference: 'prefer-cache',
          stability: 'static',
        },
        {
          role: 'system',
          content: 'SEALED',
          cachePreference: 'prefer-cache',
          stability: 'sealed',
        },
        {
          role: 'system',
          content: 'LOREBOOK',
          cachePreference: 'avoid-cache',
          stability: 'sealed',
        },
        {
          role: 'user',
          content: 'older live',
          cachePreference: 'prefer-cache',
          stability: 'live',
        },
        {
          role: 'assistant',
          content: 'older reply',
          cachePreference: 'prefer-cache',
          stability: 'live',
        },
      ],
      anthropicConversationMessages: [
        { role: 'user', content: 'older live' },
        { role: 'assistant', content: 'older reply' },
      ],
    })

    expect(result.streamRequest.providerOptions).toBeUndefined()

    expect(result.streamRequest.messages).toHaveLength(5)
    expect(result.streamRequest.messages[0]).toMatchObject({
      role: 'system',
      content: 'STATIC',
    })
    expect(result.streamRequest.messages[0]).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    })
    expect(result.streamRequest.messages[1]).toMatchObject({
      role: 'system',
      content: 'SEALED',
    })
    expect(result.streamRequest.messages[1]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.messages[2]).toMatchObject({
      role: 'system',
      content: 'LOREBOOK',
    })
    expect(result.streamRequest.messages[2]).not.toHaveProperty('providerOptions')

    expect(result.actualPayload.systemMessages).toEqual([
      { role: 'system', content: 'STATIC', cached: true },
      { role: 'system', content: 'SEALED' },
      { role: 'system', content: 'LOREBOOK' },
    ])
  })

  it.each([null, '5m', '1h'] as const)(
    'uses the static-only fallback layout with cache TTL %s',
    (ttl) => {
      const result = buildStreamPayloadPlan({
        ...BASE_ARGS,
        provider: 'anthropic',
        finalSystemPrompt: 'STATIC\n\nDYNAMIC',
        staticSystemPrompt: 'STATIC',
        dynamicContext: 'DYNAMIC',
        anthropicCache: ttl ? { enabled: true, ttl, minTokens: 2048 } : null,
        anthropicConversationMessages: [{ role: 'user', content: 'hello' }],
      })

      expect(result.streamRequest.providerOptions).toBeUndefined()
      expect(result.streamRequest.messages[0]).toEqual({
        role: 'system',
        content: 'STATIC',
        ...(ttl
          ? {
              providerOptions: {
                anthropic: {
                  cacheControl: { type: 'ephemeral', ...(ttl === '1h' ? { ttl } : {}) },
                },
              },
            }
          : {}),
      })
      expect(result.streamRequest.messages.slice(1)).toEqual([
        { role: 'system', content: 'DYNAMIC' },
        { role: 'user', content: 'hello' },
      ])
      expect(result.actualPayload.systemMessages.filter((message) => message.cached)).toHaveLength(
        ttl ? 1 : 0,
      )
    },
  )

  it('marks only the end of consecutive static system blocks', () => {
    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'RULES\nCHARACTER\nMEMORY\nLATE',
      staticSystemPrompt: 'RULES\nCHARACTER',
      dynamicContext: 'MEMORY\nLATE',
      anthropicCache: { enabled: true, ttl: '1h', minTokens: 2048 },
      anthropicConversationMessages: [{ role: 'user', content: 'hello' }],
      promptBlocks: [
        { role: 'system', content: 'RULES', stability: 'static', cachePreference: 'prefer-cache' },
        {
          role: 'system',
          content: 'CHARACTER',
          stability: 'static',
          cachePreference: 'prefer-cache',
        },
        { role: 'system', content: 'MEMORY', stability: 'sealed', cachePreference: 'prefer-cache' },
        { role: 'system', content: 'LATE', stability: 'static', cachePreference: 'prefer-cache' },
      ],
    })

    expect(result.actualPayload.systemMessages.filter((message) => message.cached)).toEqual([
      { role: 'system', content: 'CHARACTER', cached: true },
    ])
    expect(result.streamRequest.messages[1]).toMatchObject({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } } },
    })
  })

  it('does not create a cache point when the static system prompt is empty', () => {
    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'DYNAMIC',
      staticSystemPrompt: '',
      dynamicContext: 'DYNAMIC',
      anthropicCache: { enabled: true, ttl: '5m', minTokens: 2048 },
      anthropicConversationMessages: [{ role: 'user', content: 'hello' }],
    })

    expect(result.streamRequest.providerOptions).toBeUndefined()
    expect(result.streamRequest.messages.every((message) => !message.providerOptions)).toBe(true)
    expect(result.actualPayload.systemMessages.some((message) => message.cached)).toBe(false)
  })
})
