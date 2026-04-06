import { describe, expect, it } from 'vitest'
import type { SharedV2ProviderOptions } from '@ai-sdk/provider'

import { buildStreamPayloadPlan } from './stream-payload-builder'

const BASE_ARGS = {
  recentMessages: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  googleCacheResult: null,
  messagesToCacheForGoogle: [] as Array<{ role: 'user' | 'assistant'; content: string }>,
  lastMessageForGoogle: null,
}

describe('buildStreamPayloadPlan', () => {
  it('builds anthropic split-system payload with request-level automatic cache settings', () => {
    const providerOptions: SharedV2ProviderOptions = {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    }

    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: 'SUMMARIES_FACTS',
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
    expect(result.streamRequest.messages[0]).not.toHaveProperty('providerOptions')

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
    const providerOptions: SharedV2ProviderOptions = {
      anthropic: { cacheControl: { type: 'ephemeral', ttl: '1h' } },
    }

    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: null,
      anthropicConversationMessages: [{ role: 'user', content: 'hello' }],
      providerOptions,
    })

    // 1 system message + 1 conversation = 2
    expect(result.streamRequest.messages).toHaveLength(2)
    expect(result.streamRequest.providerOptions).toEqual(providerOptions)
    expect(result.streamRequest.messages[0]).not.toHaveProperty('providerOptions')
    expect(result.streamRequest.messages[0]).toMatchObject({
      role: 'system',
      content: 'STATIC',
    })
    expect(result.actualPayload.systemMessages).toEqual([
      { role: 'system', content: 'STATIC' },
    ])
  })

  it('omits request-level cache settings when anthropic providerOptions are absent', () => {
    const result = buildStreamPayloadPlan({
      ...BASE_ARGS,
      provider: 'anthropic',
      finalSystemPrompt: 'FINAL',
      staticSystemPrompt: 'STATIC',
      dynamicContext: null,
      anthropicConversationMessages: [{ role: 'user', content: 'hello' }],
    })

    // 1 system message + 1 conversation = 2
    expect(result.streamRequest.messages).toHaveLength(2)
    expect(result.streamRequest.providerOptions).toBeUndefined()
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
})
