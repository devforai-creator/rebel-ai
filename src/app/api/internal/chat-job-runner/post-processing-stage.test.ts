import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'

const estimateUsageCostMock = vi.fn()
const buildChatDebugInfoMock = vi.fn()
const runPostGenerationPipelineMock = vi.fn()

vi.mock('@/lib/model-pricing', () => ({
  estimateUsageCost: (...args: unknown[]) => estimateUsageCostMock(...args),
}))

vi.mock('./usage-debug', () => ({
  buildChatDebugInfo: (...args: unknown[]) => buildChatDebugInfoMock(...args),
}))

vi.mock('./post-generation-pipeline', () => ({
  runPostGenerationPipeline: (...args: unknown[]) => runPostGenerationPipelineMock(...args),
}))

import { runPostProcessingStage } from './post-processing-stage'

function buildPayload(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    chatId: 'chat-1',
    userId: 'user-1',
    apiKeyId: 'key-1',
    provider: 'anthropic',
    modelName: 'claude-opus-4-5',
    turnId: null,
    regenerateAssistantMessageId: null,
    ...overrides,
  }
}

describe('runPostProcessingStage', () => {
  it.each(['flex', 'standard', undefined] as const)(
    'prices Google using reported tier %s, falling back to the queued selection',
    async (googleServiceTier) => {
      await runPostProcessingStage({
        supabase: createChatJobRunnerSupabaseMock() as never,
        payload: buildPayload({
          provider: 'google',
          modelName: 'gemini-4-argon',
          serviceTier: 'flex',
        }) as never,
        origin: 'https://internal.example.com',
        context: {
          apiKeyData: { provider: 'google', service_tier: 'standard' },
          generationTranscript: [],
          finalSystemPrompt: 'SYSTEM',
          dynamicContext: '',
          dynamicContextTokens: 0,
          recentMessages: [],
          ragInfo: null,
          bilingualEnabled: false,
          anthropicConversationMessages: [],
          anthropicPlaceholderAdded: false,
          totalInputTokens: 10,
          staticPromptTokens: 10,
          debugMetrics: {},
        } as never,
        providerArtifacts: { actualPayload: { provider: 'google' }, anthropicCache: null } as never,
        streamingResponse: {
          fullText: 'Hello',
          assistantText: 'Hello',
          finishReason: 'stop',
          anthropicCacheCreationInputTokens: null,
          serviceTier: googleServiceTier,
          usage: {
            promptTokens: 10,
            completionTokens: 1,
            totalTokens: 11,
            cachedInputTokens: 0,
            reasoningTokens: 0,
          },
        },
      })
      expect(estimateUsageCostMock).toHaveBeenCalledWith(
        expect.objectContaining({ serviceTier: googleServiceTier ?? 'flex' }),
      )
    },
  )

  beforeEach(() => {
    estimateUsageCostMock.mockReset()
    buildChatDebugInfoMock.mockReset()
    runPostGenerationPipelineMock.mockReset()

    estimateUsageCostMock.mockReturnValue({ totalCost: 1.23 })
    buildChatDebugInfoMock.mockReturnValue({ requestId: 'req-1', debug: true })
    runPostGenerationPipelineMock.mockResolvedValue({
      assistantMessageId: 'assistant-1',
      messageInsertDuration: 12,
      usageEventInsertDurationMs: 34,
      summaryTriggerDurationMs: 56,
    })
  })

  it.each([undefined, 3])('persists cache-write usage: %s', async (cacheWriteTokens) => {
    const supabase = createChatJobRunnerSupabaseMock()
    const payload = buildPayload({ modelName: 'claude-haiku-5-5' })

    const result = await runPostProcessingStage({
      supabase: supabase as never,
      payload: payload as never,
      origin: 'https://internal.example.com',
      context: {
        apiKeyData: {
          provider: 'anthropic',
          vault_secret_name: 'vault-key',
          service_tier: 'standard',
          reasoning_effort: null,
        },
        generationTranscript: [{ role: 'user', content: 'Hello' }],
        finalSystemPrompt: 'SYSTEM',
        dynamicContext: 'CTX',
        dynamicContextTokens: 42,
        recentMessages: [{ role: 'user', content: 'Hello' }],
        ragInfo: {
          enabled: true,
          threshold: 0.8,
          topK: 5,
          results: [{ seq: '1', similarity: 0.92, preview: 'memory preview' }],
        },
        bilingualEnabled: true,
        anthropicConversationMessages: [{ role: 'user', content: 'Hello' }],
        anthropicPlaceholderAdded: false,
        totalInputTokens: 99,
        staticPromptTokens: 80,
        debugMetrics: {},
      },
      providerArtifacts: {
        promptCache: { key: 'chat:1', retention: '24h' },
        anthropicCache: { enabled: true, ttl: '5m', minTokens: 1024 },
        googleExplicitCacheEnabled: false,
        googleCacheDecision: null,
        googleCacheResult: null,
        actualPayload: {
          provider: 'anthropic',
          strategy: 'default',
          systemMessages: [],
          conversationMessages: [],
        },
      },
      streamingResponse: {
        fullText: 'raw text',
        assistantText: 'clean text',
        finishReason: 'stop',
        anthropicCacheCreationInputTokens: 123,
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 5,
          reasoningTokens: null,
          ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
        },
      },
    })

    expect(estimateUsageCostMock).toHaveBeenCalledWith({
      provider: 'anthropic',
      modelName: 'claude-haiku-5-5',
      promptTokens: 10,
      completionTokens: 20,
      cachedInputTokens: 5,
      reasoningTokens: null,
      totalTokens: 30,
      cacheWriteTokens: 123,
      cacheWriteTtl: '5m',
      serviceTier: 'standard',
    })
    expect(buildChatDebugInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        anthropicConversationMessages: [{ role: 'user', content: 'Hello' }],
        rawResponse: 'raw text',
        processedResponse: 'clean text',
        usage: expect.objectContaining(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
      }),
    )
    expect(runPostGenerationPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        chatId: 'chat-1',
        userId: 'user-1',
        provider: 'anthropic',
        modelName: 'claude-haiku-5-5',
        debugInfo: expect.objectContaining({
          requestId: 'req-1',
          debug: true,
          usageReceipt: expect.objectContaining({
            requestId: 'req-1',
            provider: 'anthropic',
            callCount: 1,
          }),
        }),
        usageCost: { totalCost: 1.23 },
        promptTokens: 10,
        completionTokens: 20,
      }),
    )
    expect(result).toEqual({
      messageInsertDuration: 12,
      usageEventInsertDurationMs: 34,
      summaryTriggerDurationMs: 56,
    })
  })

  it('wraps pipeline persistence failures as persisting-response execution errors', async () => {
    runPostGenerationPipelineMock.mockRejectedValue(new Error('write failed'))

    await expect(
      runPostProcessingStage({
        supabase: createChatJobRunnerSupabaseMock() as never,
        payload: buildPayload({ provider: 'openai', modelName: 'gpt-5-mini' }) as never,
        origin: 'https://internal.example.com',
        context: {
          apiKeyData: {
            provider: 'openai',
            vault_secret_name: 'vault-key',
            service_tier: 'standard',
            reasoning_effort: null,
          },
          generationTranscript: [{ role: 'user', content: 'Hello' }],
          finalSystemPrompt: 'SYSTEM',
          dynamicContext: null,
          dynamicContextTokens: 0,
          recentMessages: [{ role: 'user', content: 'Hello' }],
          ragInfo: undefined,
          bilingualEnabled: false,
          anthropicConversationMessages: [{ role: 'user', content: 'Hello' }],
          anthropicPlaceholderAdded: false,
          totalInputTokens: 99,
          staticPromptTokens: 80,
          debugMetrics: {},
        },
        providerArtifacts: {
          promptCache: null,
          anthropicCache: null,
          googleExplicitCacheEnabled: false,
          googleCacheDecision: null,
          googleCacheResult: null,
          actualPayload: null,
        },
        streamingResponse: {
          fullText: 'raw text',
          assistantText: 'clean text',
          finishReason: 'stop',
          anthropicCacheCreationInputTokens: null,
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cachedInputTokens: null,
            reasoningTokens: null,
          },
        },
      }),
    ).rejects.toMatchObject({
      message: 'write failed',
      lifecycleStage: 'persisting_response',
    })
  })

  it('leaves pre-persistence computation failures untouched', async () => {
    estimateUsageCostMock.mockImplementation(() => {
      throw new Error('cost failed')
    })

    await expect(
      runPostProcessingStage({
        supabase: createChatJobRunnerSupabaseMock() as never,
        payload: buildPayload() as never,
        origin: 'https://internal.example.com',
        context: {
          apiKeyData: {
            provider: 'anthropic',
            vault_secret_name: 'vault-key',
            service_tier: 'standard',
            reasoning_effort: null,
          },
          generationTranscript: [{ role: 'user', content: 'Hello' }],
          finalSystemPrompt: 'SYSTEM',
          dynamicContext: null,
          dynamicContextTokens: 0,
          recentMessages: [{ role: 'user', content: 'Hello' }],
          ragInfo: undefined,
          bilingualEnabled: false,
          anthropicConversationMessages: [{ role: 'user', content: 'Hello' }],
          anthropicPlaceholderAdded: false,
          totalInputTokens: 99,
          staticPromptTokens: 80,
          debugMetrics: {},
        },
        providerArtifacts: {
          promptCache: null,
          anthropicCache: null,
          googleExplicitCacheEnabled: false,
          googleCacheDecision: null,
          googleCacheResult: null,
          actualPayload: null,
        },
        streamingResponse: {
          fullText: 'raw text',
          assistantText: 'clean text',
          finishReason: 'stop',
          anthropicCacheCreationInputTokens: null,
          usage: {
            promptTokens: 10,
            completionTokens: 20,
            totalTokens: 30,
            cachedInputTokens: null,
            reasoningTokens: null,
          },
        },
      }),
    ).rejects.toThrow('cost failed')
  })
})
