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
const prepareExperimentalAgenticTranscriptRecallRequestMock = vi.fn()

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
  ANTHROPIC_INTERLEAVED_THINKING_BETA: 'interleaved-thinking-2025-05-14',
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

vi.mock('@/lib/experimental/agentic-transcript-recall/runner', () => ({
  prepareExperimentalAgenticTranscriptRecallRequest: (...args: unknown[]) =>
    prepareExperimentalAgenticTranscriptRecallRequestMock(...args),
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
    agenticTranscriptRecall: {
      configured: false,
      accountDefaultEnabled: false,
      preferenceSource: 'account_default',
      globallyEnabled: false,
      providerSupported: true,
      providerAllowed: true,
      enabled: false,
      skipReason: 'disabled_by_global_flag',
      maxToolCalls: 1,
      maxMessagesPerCall: 12,
      maxTotalMessages: 12,
      providerAllowlist: ['openai'],
    },
    agenticTranscriptRecallSourceHints: null,
    agenticTranscriptRecallSourceMap: null,
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
    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReset()

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
    prepareExperimentalAgenticTranscriptRecallRequestMock.mockImplementation(
      ({ streamRequest }) => ({
        streamRequest,
      }),
    )
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
    expect(context.debugMetrics).toMatchObject({
      anthropic_thinking_requested: null,
      anthropic_thinking_type: null,
      anthropic_thinking_effort: null,
      anthropic_interleaved_thinking_requested: null,
    })
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

  it('records anthropic adaptive-thinking request metrics when anthropic options are present', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload({
      provider: 'anthropic',
      modelName: 'claude-opus-4-7',
    })
    const context = buildContext()
    getProviderOptionsMock.mockReturnValue({
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: 'medium',
        anthropicBeta: ['interleaved-thinking-2025-05-14'],
      },
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-anthropic-1',
      payload,
      context,
      timings: {},
    })

    expect(context.debugMetrics).toMatchObject({
      anthropic_thinking_requested: true,
      anthropic_thinking_type: 'adaptive',
      anthropic_thinking_effort: 'medium',
      anthropic_interleaved_thinking_requested: true,
    })
  })

  it('routes enabled chats through the experimental wrapper seam before streaming', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload()
    const context = buildContext({
      agenticTranscriptRecall: {
        configured: true,
        accountDefaultEnabled: false,
        preferenceSource: 'chat_override',
        globallyEnabled: true,
        providerSupported: true,
        providerAllowed: true,
        enabled: true,
        skipReason: null,
        maxToolCalls: 1,
        maxMessagesPerCall: 12,
        maxTotalMessages: 12,
        providerAllowlist: ['openai'],
      },
      debugMetrics: {},
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-1',
      payload,
      context,
      timings: {},
    })

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { kind: 'model' },
        temperature: 0.7,
        system: 'FINAL',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    )
    expect(prepareExperimentalAgenticTranscriptRecallRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceMap: null,
        streamRequest: expect.objectContaining({
          system: 'FINAL',
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      }),
    )
    expect(context.debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_wrapper_used: true,
      experimental_agentic_transcript_recall_fallback_to_standard: false,
    })
  })

  it('passes google streaming requests through the experimental wrapper seam with tools intact', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload({
      provider: 'google',
      modelName: 'gemini-2.5-flash',
    })
    const context = buildContext({
      agenticTranscriptRecall: {
        configured: true,
        accountDefaultEnabled: false,
        preferenceSource: 'chat_override',
        globallyEnabled: true,
        providerSupported: true,
        providerAllowed: true,
        enabled: true,
        skipReason: null,
        maxToolCalls: 2,
        maxMessagesPerCall: 12,
        maxTotalMessages: 12,
        providerAllowlist: ['google'],
      },
      debugMetrics: {},
    })

    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        system: 'FINAL\n\nExperimental',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      streamTextSettings: {
        tools: {
          expand_source_range: {},
          fetch_source_range: {},
        },
      },
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-google-tools',
      payload,
      context,
      timings: {},
    })

    expect(buildLanguageModelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'google',
        modelName: 'gemini-2.5-flash',
        apiKey: 'sk-test',
      }),
    )
    expect(prepareExperimentalAgenticTranscriptRecallRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        runtimeConfig: expect.objectContaining({
          enabled: true,
          providerAllowlist: ['google'],
        }),
      }),
    )
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { kind: 'model' },
        temperature: 0.7,
        system: 'FINAL\n\nExperimental',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: {
          expand_source_range: {},
          fetch_source_range: {},
        },
      }),
    )
    expect(context.debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_wrapper_used: true,
      experimental_agentic_transcript_recall_fallback_to_standard: false,
    })
  })

  it('falls back to the standard stream request when the experimental wrapper fails', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload()
    const context = buildContext({
      agenticTranscriptRecall: {
        configured: true,
        accountDefaultEnabled: false,
        preferenceSource: 'chat_override',
        globallyEnabled: true,
        providerSupported: true,
        providerAllowed: true,
        enabled: true,
        skipReason: null,
        maxToolCalls: 1,
        maxMessagesPerCall: 12,
        maxTotalMessages: 12,
        providerAllowlist: ['openai'],
      },
      debugMetrics: {},
    })
    const logDebug = vi.fn()

    prepareExperimentalAgenticTranscriptRecallRequestMock.mockImplementationOnce(() => {
      throw new Error('wrapper exploded')
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-1',
      payload,
      context,
      timings: {},
      logDebug,
    })

    expect(streamTextMock).toHaveBeenCalledWith({
      model: { kind: 'model' },
      temperature: 0.7,
      system: 'FINAL',
      messages: [{ role: 'user', content: 'Hello' }],
    })
    expect(context.debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_wrapper_used: true,
      experimental_agentic_transcript_recall_fallback_to_standard: true,
    })
    expect(logDebug).toHaveBeenCalledWith(
      '[Agentic Transcript Recall] Experimental wrapper failed; falling back',
      expect.objectContaining({
        error: 'wrapper exploded',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
      }),
    )
  })

  it('falls back to the standard stream request when the experimental stream invocation fails', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload()
    const context = buildContext({
      agenticTranscriptRecall: {
        configured: true,
        accountDefaultEnabled: false,
        preferenceSource: 'chat_override',
        globallyEnabled: true,
        providerSupported: true,
        providerAllowed: true,
        enabled: true,
        skipReason: null,
        maxToolCalls: 1,
        maxMessagesPerCall: 12,
        maxTotalMessages: 12,
        providerAllowlist: ['openai'],
      },
      debugMetrics: {},
    })
    const logDebug = vi.fn()

    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        system: 'FINAL\n\nExperimental',
        messages: [{ role: 'user', content: 'Hello' }],
      },
      streamTextSettings: {
        tools: {
          expand_source_range: {},
          fetch_source_range: {},
        },
      },
    })

    streamTextMock
      .mockRejectedValueOnce(new Error('experimental stream failed'))
      .mockResolvedValueOnce({
        textStream: [],
        finishReason: Promise.resolve('stop'),
        providerMetadata: Promise.resolve({}),
        usage: Promise.resolve(null),
      })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-1',
      payload,
      context,
      timings: {},
      logDebug,
    })

    expect(streamTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        system: 'FINAL\n\nExperimental',
        tools: {
          expand_source_range: {},
          fetch_source_range: {},
        },
      }),
    )
    expect(streamTextMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        system: 'FINAL',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    )
    expect(context.debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_wrapper_used: true,
      experimental_agentic_transcript_recall_fallback_to_standard: true,
    })
    expect(logDebug).toHaveBeenCalledWith(
      '[Agentic Transcript Recall] Experimental stream request failed; falling back',
      expect.objectContaining({
        error: 'experimental stream failed',
        provider: 'openai',
        modelName: 'gpt-4o-mini',
      }),
    )
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

  it('skips google explicit cache creation when compatibility retry disables it', async () => {
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
      debugMetrics: {},
    })

    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    buildStreamPayloadPlanMock.mockReturnValueOnce({
      strategy: 'default',
      streamRequest: {
        system: 'FINAL',
        messages: [
          { role: 'user', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
      },
      actualPayload: {
        provider: 'google',
        strategy: 'default',
        systemMessages: [{ role: 'system', content: 'FINAL' }],
        conversationMessages: [
          { role: 'user', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
      },
    })

    const result = await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-google-retry',
      payload,
      context,
      timings: {},
      disableGoogleExplicitCache: true,
    })

    expect(createGoogleCacheMock).not.toHaveBeenCalled()
    expect(buildStreamPayloadPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        googleCacheResult: null,
      }),
    )
    expect(result).toMatchObject({
      status: 'streaming',
      googleExplicitCacheEnabled: false,
      googleCacheDecision: { enabled: true, minTokens: 1024 },
      googleCacheResult: null,
    })
    expect(context.debugMetrics).toMatchObject({
      google_explicit_cache_disabled_for_compatibility_retry: true,
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
