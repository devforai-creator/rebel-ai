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

  it('builds post-generation artifacts and persists the response through the pipeline', async () => {
    const supabase = createChatJobRunnerSupabaseMock()
    const payload = buildPayload()

    const result = await runPostProcessingStage({
      supabase: supabase as never,
      payload: payload as never,
      origin: 'https://internal.example.com',
      context: {
        apiKeyData: {
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
        },
      },
    })

    expect(estimateUsageCostMock).toHaveBeenCalledWith({
      provider: 'anthropic',
      modelName: 'claude-opus-4-5',
      promptTokens: 10,
      completionTokens: 20,
      cachedInputTokens: 5,
      reasoningTokens: undefined,
      serviceTier: 'standard',
    })
    expect(buildChatDebugInfoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'req-1',
        anthropicConversationMessages: [{ role: 'user', content: 'Hello' }],
        rawResponse: 'raw text',
        processedResponse: 'clean text',
      }),
    )
    expect(runPostGenerationPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase,
        chatId: 'chat-1',
        userId: 'user-1',
        provider: 'anthropic',
        modelName: 'claude-opus-4-5',
        debugInfo: { requestId: 'req-1', debug: true },
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
