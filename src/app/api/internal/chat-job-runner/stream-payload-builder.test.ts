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
  anthropicPlaceholderAdded: false,
  recentMessages: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  googleCacheResult: null,
  messagesToCacheForGoogle: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  lastMessageForGoogle: null,
}

describe('buildStreamPayloadPlan', () => {
  it('builds anthropic split-system payload with cache on the static prompt', () => {
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
    expect(result.streamRequest.providerOptions).toEqual(providerOptions)

    // 2 system messages + 2 conversation = 4 total
    expect(result.streamRequest.messages).toHaveLength(4)

    // System 1: static (cached)
    expect(result.streamRequest.messages[0]).toMatchObject({
      role: 'system',
      content: 'STATIC',
    })
    expect(result.streamRequest.messages[0]).toHaveProperty('providerOptions')

    // System 2: summaries+facts (NOT cached)
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
        { role: 'system', content: 'SUMMARIES_FACTS', cached: false },
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

    // 1 system message (static cached) + 1 conversation = 2
    expect(result.streamRequest.messages).toHaveLength(2)
    expect(result.streamRequest.messages[0]).toHaveProperty('providerOptions')
    expect(result.streamRequest.messages[0]).toMatchObject({
      role: 'system',
      content: 'STATIC',
    })
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

    // 1 system message (static, no cache) + 1 conversation = 2
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

  it('places anthropic cache control on the last live block for prefix mode', () => {
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
    expect(result.streamRequest.messages[4]).toMatchObject({
      role: 'user',
      content: 'latest user',
    })
    expect(result.streamRequest.messages[4]).toHaveProperty('providerOptions')
    expect(result.actualPayload.conversationMessages).toEqual([
      { role: 'user', content: 'older live' },
      { role: 'assistant', content: 'older reply' },
      { role: 'user', content: 'latest user' },
    ])
  })
})
