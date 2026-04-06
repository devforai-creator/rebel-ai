import { describe, expect, it } from 'vitest'

import {
  appendSummaryWarningToDebugInfo,
  buildChatDebugInfo,
  buildChatUsageEvent,
  type ChatRunnerActualPayload,
} from './usage-debug'

describe('usage-debug helpers', () => {
  describe('buildChatDebugInfo', () => {
    it('builds debug info with cache metadata and usage details', () => {
      const actualPayload: ChatRunnerActualPayload = {
        provider: 'openai',
        strategy: 'default',
        systemMessages: [{ role: 'system', content: 'SYS' }],
        conversationMessages: [{ role: 'user', content: 'hello' }],
      }

      const result = buildChatDebugInfo({
        requestId: 'req-1',
        finalSystemPrompt: 'SYS',
        recentMessages: [{ role: 'assistant', content: 'recent' }],
        anthropicConversationMessages: [{ role: 'user', content: 'anthropic-msg' }],
        anthropicPlaceholderAdded: true,
        promptCache: { key: 'ctx:key', retention: '24h' },
        totalInputTokens: 1200,
        anthropicCache: { enabled: true, ttl: '1h', minTokens: 1024 },
        anthropicCacheCreationInputTokens: 44,
        anthropicCacheReadInputTokens: 5,
        staticPromptTokens: 300,
        dynamicContext: 'DYN',
        dynamicContextTokens: 123,
        googleExplicitCacheEnabled: true,
        googleCacheResult: {
          success: true,
          cacheName: 'cache-name',
          cachedTokenCount: 456,
          expireTime: '2026-02-10T00:00:00.000Z',
          ttl: '20s',
        },
        googleCacheDecision: { enabled: true, minTokens: 1024 },
        rawResponse: ' raw ',
        processedResponse: 'raw',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        finishReason: 'stop',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 5,
          reasoningTokens: 1,
        },
        sanitizedMessageCount: 2,
        ragInfo: { enabled: true },
        actualPayload,
      })

      expect(result).toMatchObject({
        requestId: 'req-1',
        fullPrompt: {
          system: 'SYS',
          messages: [{ role: 'assistant', content: 'recent' }],
          anthropicConversationMessages: [{ role: 'user', content: 'anthropic-msg' }],
          anthropicPlaceholderAdded: true,
        },
        promptCache: {
          key: 'ctx:key',
          retention: '24h',
          totalInputTokens: 1200,
        },
        anthropicCache: {
          enabled: true,
          ttl: '1h',
          minTokens: 1024,
          staticPromptTokens: 300,
          estimatedMeetsMinTokens: false,
          cachedSystemTokens: 300,
          dynamicContextTokens: 123,
          cacheCreationInputTokens: 44,
          cacheReadInputTokens: 5,
        },
        googleCache: {
          featureEnabled: true,
          cacheCreated: true,
          cacheName: 'cache-name',
          cachedTokenCount: 456,
          expireTime: '2026-02-10T00:00:00.000Z',
          actualTtl: '20s',
          error: null,
          minTokens: 1024,
          meetsMinTokens: true,
        },
        rawResponse: ' raw ',
        processedResponse: 'raw',
        cacheHit: true,
        modelConfig: {
          apiKeyId: 'key-1',
          provider: 'openai',
          modelName: 'gpt-4o-mini',
          finishReason: 'stop',
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cachedInputTokens: 5,
            reasoningTokens: 1,
          },
        },
        systemPromptLength: 3,
        sanitizedMessageCount: 2,
        rag: { enabled: true },
        actualPayload,
      })
      expect(typeof result.timestamp).toBe('string')
    })

    it('uses safe defaults when cache data is absent', () => {
      const result = buildChatDebugInfo({
        requestId: 'req-2',
        finalSystemPrompt: 'SYSTEM',
        recentMessages: [],
        anthropicConversationMessages: null,
        anthropicPlaceholderAdded: false,
        promptCache: null,
        totalInputTokens: 0,
        anthropicCache: null,
        anthropicCacheCreationInputTokens: null,
        anthropicCacheReadInputTokens: null,
        staticPromptTokens: 0,
        dynamicContext: null,
        dynamicContextTokens: 999,
        googleExplicitCacheEnabled: false,
        googleCacheResult: { success: false, error: 'cache failed' },
        googleCacheDecision: null,
        rawResponse: '',
        processedResponse: '',
        apiKeyId: 'key-2',
        provider: 'anthropic',
        modelName: 'claude',
        finishReason: null,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
        },
        sanitizedMessageCount: 0,
        ragInfo: null,
        actualPayload: null,
      })

      expect(result).toMatchObject({
        promptCache: null,
        anthropicCache: null,
        googleCache: {
          featureEnabled: false,
          cacheCreated: false,
          cacheName: null,
          cachedTokenCount: 0,
          expireTime: null,
          actualTtl: null,
          error: 'cache failed',
          minTokens: null,
          meetsMinTokens: false,
        },
        cacheHit: false,
        modelConfig: {
          finishReason: null,
          usage: {
            promptTokens: null,
            completionTokens: null,
            totalTokens: null,
            cachedInputTokens: null,
            reasoningTokens: null,
          },
        },
      })
    })
  })

  describe('buildChatUsageEvent', () => {
    it('maps usage/cost data into chat_usage_events insert payload', () => {
      const result = buildChatUsageEvent({
        userId: 'user-1',
        chatId: 'chat-1',
        apiKeyId: 'key-1',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 3,
          reasoningTokens: 1,
        },
        usageCost: {
          promptTokens: 10,
          completionTokens: 20,
          cachedInputTokens: 3,
          reasoningTokens: 1,
          promptCost: 0.01,
          completionCost: 0.02,
          cachedInputCost: 0.003,
          reasoningCost: 0.001,
          totalCost: 0.034,
        },
        requestId: 'req-1',
      })

      expect(result).toEqual({
        user_id: 'user-1',
        chat_id: 'chat-1',
        api_key_id: 'key-1',
        model_provider: 'openai',
        model_name: 'gpt-4o-mini',
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        cached_input_tokens: 3,
        reasoning_tokens: 1,
        prompt_cost_usd: 0.01,
        cached_input_cost_usd: 0.003,
        completion_cost_usd: 0.02,
        reasoning_cost_usd: 0.001,
        total_cost_usd: 0.034,
        request_id: 'req-1',
      })
    })

    it('falls back to zero cost when usageCost is missing', () => {
      const result = buildChatUsageEvent({
        userId: 'user-2',
        chatId: 'chat-2',
        apiKeyId: 'key-2',
        provider: 'anthropic',
        modelName: 'claude',
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
          cachedInputTokens: null,
          reasoningTokens: null,
        },
        usageCost: null,
        requestId: 'req-2',
      })

      expect(result.prompt_cost_usd).toBe(0)
      expect(result.cached_input_cost_usd).toBe(0)
      expect(result.completion_cost_usd).toBe(0)
      expect(result.reasoning_cost_usd).toBe(0)
      expect(result.total_cost_usd).toBe(0)
    })
  })

  describe('appendSummaryWarningToDebugInfo', () => {
    it('adds summary warning while preserving prior debug fields', () => {
      const result = appendSummaryWarningToDebugInfo(
        {
          requestId: 'req-1',
          modelConfig: { provider: 'openai' },
        },
        { error: 'summary failed', attempts: 2 },
      )

      expect(result).toMatchObject({
        requestId: 'req-1',
        modelConfig: { provider: 'openai' },
        summaryWarning: {
          error: 'summary failed',
          attempts: 2,
        },
      })
      expect(typeof (result.summaryWarning as { timestamp?: unknown }).timestamp).toBe('string')
    })
  })
})
