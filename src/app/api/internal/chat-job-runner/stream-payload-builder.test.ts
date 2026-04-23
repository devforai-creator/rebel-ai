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
  googleCacheResult: null,
  messagesToCacheForGoogle: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  lastMessageForGoogle: null,
}

describe('buildStreamPayloadPlan', () => {
  it('builds anthropic split-system payload with automatic cache control at request level', () => {
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
        cacheControl: { type: 'ephemeral' },
      },
    })

    // 2 system messages + 2 conversation = 4 total
    expect(result.streamRequest.messages).toHaveLength(4)

    // System 1: static
    expect(result.streamRequest.messages[0]).toMatchObject({
      role: 'system',
      content: 'STATIC',
    })
    expect(result.streamRequest.messages[0]).not.toHaveProperty('providerOptions')

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
        { role: 'system', content: 'STATIC' },
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
    expect(result.streamRequest.messages[0]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.providerOptions).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    })
    expect(result.actualPayload.systemMessages).toEqual([{ role: 'system', content: 'STATIC' }])
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
      googleCacheResult: {
        success: true,
        cacheName: 'cache-name',
        cachedTokenCount: 400,
        ttl: '20s',
        expireTime: '2026-02-10T00:00:00.000Z',
      },
      messagesToCacheForGoogle: [{ role: 'user', content: 'old message' }],
      lastMessageForGoogle: { role: 'assistant', content: 'last response' },
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
      googleCacheResult: { success: false, error: 'cache failed' },
      messagesToCacheForGoogle: [],
      lastMessageForGoogle: null,
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
      googleCacheResult: null,
      messagesToCacheForGoogle: [{ role: 'assistant', content: 'Older context' }],
      lastMessageForGoogle: { role: 'user', content: 'Last message' },
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

  it('uses request-level automatic cache control for prefix mode', () => {
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
    expect(result.streamRequest.messages[0]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.messages[1]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.messages[4]).toMatchObject({
      role: 'user',
      content: 'latest user',
    })
    expect(result.streamRequest.messages[4]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.providerOptions).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    })
    expect(result.actualPayload.conversationMessages).toEqual([
      { role: 'user', content: 'older live' },
      { role: 'assistant', content: 'older reply' },
      { role: 'user', content: 'latest user' },
    ])
  })

  it('adds an explicit system breakpoint before dynamic lorebook while keeping automatic caching', () => {
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

    expect(result.streamRequest.providerOptions).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    })

    expect(result.streamRequest.messages).toHaveLength(5)
    expect(result.streamRequest.messages[0]).toMatchObject({
      role: 'system',
      content: 'STATIC',
    })
    expect(result.streamRequest.messages[0]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.messages[1]).toMatchObject({
      role: 'system',
      content: 'SEALED',
      providerOptions: {
        anthropic: {
          cacheControl: { type: 'ephemeral' },
        },
      },
    })
    expect(result.streamRequest.messages[2]).toMatchObject({
      role: 'system',
      content: 'LOREBOOK',
    })
    expect(result.streamRequest.messages[2]).not.toHaveProperty('providerOptions')

    expect(result.actualPayload.systemMessages).toEqual([
      { role: 'system', content: 'STATIC' },
      { role: 'system', content: 'SEALED', cached: true },
      { role: 'system', content: 'LOREBOOK' },
    ])
  })
})
