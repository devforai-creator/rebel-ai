import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
} from '@/lib/chat/delivery-mode'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { createChatJobRunnerSupabaseMock } from '@/tests/mocks/supabase'
import type { LoadedChatJobExecutionContext } from './execution-context'

const streamTextMock = vi.fn()
const resolvePromptCacheDecisionMock = vi.fn()
const resolveAnthropicCacheDecisionMock = vi.fn()
const createGoogleCacheMock = vi.fn()
const resolveGoogleCacheDecisionMock = vi.fn()
const isGoogleExplicitCacheEnabledMock = vi.fn()
const getProviderOptionsMock = vi.fn()
const resolveInvocationSamplingOptionsMock = vi.fn()
const normalizeProviderErrorMock = vi.fn()
const buildLanguageModelMock = vi.fn()
const buildStreamPayloadPlanMock = vi.fn()
const submitAnthropicBatchJobMock = vi.fn()

vi.mock('ai', () => ({
  streamText: (...args: unknown[]) => streamTextMock(...args),
}))

vi.mock('@/lib/llm/prompt-cache', () => ({
  resolvePromptCacheDecision: (...args: unknown[]) => resolvePromptCacheDecisionMock(...args),
  resolveAnthropicCacheDecision: (...args: unknown[]) => resolveAnthropicCacheDecisionMock(...args),
}))

vi.mock('@/lib/llm/google-cache', () => ({
  createGoogleCache: (...args: unknown[]) => createGoogleCacheMock(...args),
  resolveGoogleCacheDecision: (...args: unknown[]) => resolveGoogleCacheDecisionMock(...args),
  isGoogleExplicitCacheEnabled: (...args: unknown[]) => isGoogleExplicitCacheEnabledMock(...args),
}))

vi.mock('@/lib/llm/provider-options', () => ({
  getProviderOptions: (...args: unknown[]) => getProviderOptionsMock(...args),
}))

vi.mock('@/lib/llm/invocation-sampling', () => ({
  resolveInvocationSamplingOptions: (...args: unknown[]) =>
    resolveInvocationSamplingOptionsMock(...args),
}))

vi.mock('@/lib/llm/provider-error', () => ({
  normalizeProviderError: (...args: unknown[]) => normalizeProviderErrorMock(...args),
}))

vi.mock('./model-factory', () => ({
  buildLanguageModel: (...args: unknown[]) => buildLanguageModelMock(...args),
}))

vi.mock('./stream-payload-builder', () => ({
  buildStreamPayloadPlan: (...args: unknown[]) => buildStreamPayloadPlanMock(...args),
}))

vi.mock('./anthropic-batch-orchestrator', () => ({
  submitAnthropicBatchJob: (...args: unknown[]) => submitAnthropicBatchJobMock(...args),
}))

function buildPayload(overrides: Partial<ChatGenerationJobPayload> = {}): ChatGenerationJobPayload {
  return {
    version: CHAT_JOB_PAYLOAD_VERSION,
    requestId: 'req-1',
    chatId: 'chat-1',
    turnId: null,
    userId: 'user-1',
    apiKeyId: 'key-1',
    provider: 'openai',
    modelName: 'gpt-4o-mini',
    deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
    sanitizedMessages: [{ role: 'user', content: 'Hello' }],
    isRegeneration: false,
    regenerateAssistantMessageId: null,
    ...overrides,
  }
}

function buildContext(
  overrides: Partial<LoadedChatJobExecutionContext> = {},
): LoadedChatJobExecutionContext {
  return {
    apiKeyData: {
      vault_secret_name: 'vault-key',
      service_tier: 'standard',
      reasoning_effort: 'medium',
    },
    decryptedApiKey: 'sk-test',
    generationTranscript: [{ role: 'user', content: 'Hello' }],
    finalSystemPrompt: 'FINAL',
    staticSystemPrompt: 'STATIC',
    dynamicContext: null,
    dynamicContextTokens: 0,
    promptBlocks: [],
    recentMessages: [{ role: 'user', content: 'Hello' }],
    ragInfo: undefined,
    bilingualEnabled: false,
    anthropicConversationMessages: [{ role: 'user', content: 'Hello' }],
    anthropicPlaceholderAdded: false,
    totalInputTokens: 1200,
    staticPromptTokens: 600,
    debugMetrics: {},
    ...overrides,
  }
}

describe('requestProviderStage', () => {
  beforeEach(() => {
    streamTextMock.mockReset()
    resolvePromptCacheDecisionMock.mockReset()
    resolveAnthropicCacheDecisionMock.mockReset()
    createGoogleCacheMock.mockReset()
    resolveGoogleCacheDecisionMock.mockReset()
    isGoogleExplicitCacheEnabledMock.mockReset()
    getProviderOptionsMock.mockReset()
    resolveInvocationSamplingOptionsMock.mockReset()
    normalizeProviderErrorMock.mockReset()
    buildLanguageModelMock.mockReset()
    buildStreamPayloadPlanMock.mockReset()
    submitAnthropicBatchJobMock.mockReset()

    resolvePromptCacheDecisionMock.mockReturnValue(null)
    resolveAnthropicCacheDecisionMock.mockReturnValue(null)
    resolveGoogleCacheDecisionMock.mockReturnValue({ enabled: false, minTokens: null })
    isGoogleExplicitCacheEnabledMock.mockReturnValue(true)
    getProviderOptionsMock.mockReturnValue({ openai: { promptCache: true } })
    resolveInvocationSamplingOptionsMock.mockReturnValue({ temperature: 0.7 })
    normalizeProviderErrorMock.mockReturnValue({ userMessage: 'Friendly provider error' })
    buildLanguageModelMock.mockReturnValue({ kind: 'model' })
    buildStreamPayloadPlanMock.mockReturnValue({
      strategy: 'default',
      streamRequest: {
        system: 'FINAL',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      actualPayload: {
        provider: 'openai',
        strategy: 'default',
        systemMessages: [{ role: 'system', content: 'FINAL' }],
        conversationMessages: [{ role: 'user', content: 'Hello' }],
      },
    })
    streamTextMock.mockResolvedValue({
      textStream: [],
      finishReason: Promise.resolve('stop'),
      providerMetadata: Promise.resolve({}),
      usage: Promise.resolve(null),
    })
  })

  it('returns a streaming request with request-stage artifacts', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload()
    const context = buildContext()

    const result = await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-1',
      payload,
      context,
      timings: {},
    })

    expect(buildLanguageModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        modelName: 'gpt-4o-mini',
        apiKey: 'sk-test',
      }),
    )
    expect(streamTextMock).toHaveBeenCalledWith({
      model: { kind: 'model' },
      temperature: 0.7,
      system: 'FINAL',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(result).toMatchObject({
      status: 'streaming',
      promptCache: null,
      anthropicCache: null,
      googleExplicitCacheEnabled: true,
      googleCacheDecision: null,
      googleCacheResult: null,
      actualPayload: expect.objectContaining({
        provider: 'openai',
        strategy: 'default',
      }),
    })
  })

  it('creates a google explicit cache before building the request plan', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload({
      provider: 'google',
      modelName: 'gemini-2.5-flash',
    })
    const context = buildContext({
      recentMessages: [
        { role: 'user', content: 'Older context' },
        { role: 'user', content: 'Last message' },
      ],
    })
    const timings: Record<string, number> = {}

    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    createGoogleCacheMock.mockResolvedValueOnce({
      success: true,
      cacheName: 'cache-1',
      cachedTokenCount: 2048,
    })
    buildStreamPayloadPlanMock.mockReturnValueOnce({
      strategy: 'google-explicit-cache',
      streamRequest: {
        messages: [{ role: 'user', content: 'Last message' }],
      },
      actualPayload: {
        provider: 'google',
        strategy: 'google-explicit-cache',
        systemMessages: [{ role: 'system', content: 'FINAL' }],
        conversationMessages: [{ role: 'user', content: 'Last message' }],
        cache: {
          cacheName: 'cache-1',
          cachedTokenCount: 2048,
        },
      },
    })

    const result = await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-google',
      payload,
      context,
      timings,
    })

    expect(createGoogleCacheMock).toHaveBeenCalledWith({
      apiKey: 'sk-test',
      modelName: 'gemini-2.5-flash',
      systemPrompt: 'FINAL',
      messagesToCache: [{ role: 'user', content: 'Older context' }],
      ttlSeconds: 20,
    })
    expect(buildStreamPayloadPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        googleCacheResult: {
          success: true,
          cacheName: 'cache-1',
          cachedTokenCount: 2048,
        },
        messagesToCacheForGoogle: [{ role: 'user', content: 'Older context' }],
        lastMessageForGoogle: { role: 'user', content: 'Last message' },
      }),
    )
    expect(timings).toEqual(
      expect.objectContaining({
        '7c_google_cache_create': expect.any(Number),
      }),
    )
    expect(result).toMatchObject({
      status: 'streaming',
      googleCacheDecision: { enabled: true, minTokens: 1024 },
      googleCacheResult: {
        success: true,
        cacheName: 'cache-1',
        cachedTokenCount: 2048,
      },
      actualPayload: expect.objectContaining({
        strategy: 'google-explicit-cache',
      }),
    })
  })

  it('submits anthropic batch jobs without calling streamText', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload({
      provider: 'anthropic',
      modelName: 'claude-opus-4-5',
      deliveryMode: CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
    })
    const context = buildContext({
      anthropicConversationMessages: [{ role: 'user', content: 'Hello' }],
      recentMessages: [{ role: 'user', content: 'Hello' }],
      anthropicPlaceholderAdded: true,
      staticPromptTokens: 700,
      dynamicContext: 'DYNAMIC',
      dynamicContextTokens: 200,
    })

    resolveAnthropicCacheDecisionMock.mockReturnValueOnce({
      enabled: true,
      ttl: '5m',
      minTokens: 1024,
    })
    buildStreamPayloadPlanMock.mockReturnValueOnce({
      strategy: 'anthropic-split-system',
      streamRequest: {
        messages: [{ role: 'user', content: 'Hello' }],
      },
      actualPayload: {
        provider: 'anthropic',
        strategy: 'anthropic-split-system',
        systemMessages: [{ role: 'system', content: 'STATIC', cached: true }],
        conversationMessages: [{ role: 'user', content: 'Hello' }],
      },
    })

    const result = await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-batch',
      payload,
      context,
      timings: {},
      logDebug: vi.fn(),
    })

    expect(submitAnthropicBatchJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-batch',
        payload,
        apiKey: 'sk-test',
        debug: expect.objectContaining({
          requestId: 'req-1',
          anthropicPlaceholderAdded: true,
          sanitizedMessageCount: 1,
          bilingualEnabled: false,
        }),
      }),
    )
    expect(streamTextMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'processing',
      anthropicCache: {
        enabled: true,
        ttl: '5m',
        minTokens: 1024,
      },
      actualPayload: expect.objectContaining({
        provider: 'anthropic',
        strategy: 'anthropic-split-system',
      }),
    })
  })

  it('normalizes provider request errors before they leave the stage', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')

    streamTextMock.mockRejectedValueOnce(new Error('raw upstream failure'))

    await expect(
      requestProviderStage({
        supabase: createChatJobRunnerSupabaseMock() as never,
        jobId: 'job-error',
        payload: buildPayload(),
        context: buildContext(),
        timings: {},
      }),
    ).rejects.toThrow('Friendly provider error')

    expect(normalizeProviderErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
      }),
    )
  })
})
