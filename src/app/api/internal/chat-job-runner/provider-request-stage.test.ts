import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
} from '@/lib/chat/delivery-mode'
import { CHAT_JOB_PAYLOAD_VERSION, type ChatGenerationJobPayload } from '@/lib/chat/job-payload'
import { CHAT_RUNNER_LIMITS } from '@/lib/chat/runtime-limits'
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

vi.mock('@/lib/experimental/agentic-transcript-recall/runner', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/experimental/agentic-transcript-recall/runner')
  >('@/lib/experimental/agentic-transcript-recall/runner')

  return {
    ...actual,
    prepareExperimentalAgenticTranscriptRecallRequest: (...args: unknown[]) =>
      prepareExperimentalAgenticTranscriptRecallRequestMock(...args),
  }
})

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
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { kind: 'model' },
        temperature: 0.7,
        system: 'FINAL',
        messages: [{ role: 'user', content: 'Hello' }],
        abortSignal: expect.any(AbortSignal),
      }),
    )
    expect(result).toMatchObject({
      status: 'streaming',
      promptCache: null,
      anthropicCache: null,
      googleExplicitCacheEnabled: false,
      googleCacheDecision: null,
      googleCacheResult: null,
      actualPayload: expect.objectContaining({
        provider: 'openai',
        strategy: 'default',
      }),
    })
  })

  it('sets a provider stream abort timeout below the route execution limit', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')

    try {
      await requestProviderStage({
        supabase: createChatJobRunnerSupabaseMock() as never,
        jobId: 'job-timeout-signal',
        payload: buildPayload(),
        context: buildContext(),
        timings: {},
      })
      expect(timeoutSpy).toHaveBeenCalledWith(CHAT_RUNNER_LIMITS.providerStreamTimeoutMs)
    } finally {
      timeoutSpy.mockRestore()
    }

    expect(CHAT_RUNNER_LIMITS.providerStreamTimeoutMs).toBeLessThan(300_000)
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

  it('forces required tool choice when the character-chat preflight matches older exact recall', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload()
    const context = buildContext({
      recentMessages: [
        { role: 'assistant', content: '지난 약속을 떠올리며 숨을 고른다.' },
        { role: 'user', content: '지난번에 한 약속 정확히 다시 말해줘.' },
      ],
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
      agenticTranscriptRecallSourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older promise',
          },
        ],
      },
      agenticTranscriptRecallSourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older promise',
          },
        ],
        navigationParents: [],
      },
      debugMetrics: {},
    })

    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        system: 'FINAL\n\nExperimental',
        messages: context.recentMessages,
      },
      streamTextSettings: {
        tools: {
          fetch_source_range: {},
        },
      },
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-force-required',
      payload,
      context,
      timings: {},
    })

    const streamRequest = streamTextMock.mock.calls[0]?.[0]
    expect(streamRequest).toMatchObject({
      system: 'FINAL\n\nExperimental',
      messages: context.recentMessages,
      tools: {
        fetch_source_range: {},
      },
    })
    expect(streamRequest).not.toHaveProperty('toolChoice', 'required')
    expect(streamRequest.prepareStep).toEqual(expect.any(Function))
    expect(
      await streamRequest.prepareStep({
        stepNumber: 0,
        steps: [],
        model: { kind: 'model' },
        messages: [],
      }),
    ).toEqual({
      toolChoice: 'required',
    })
    expect(
      await streamRequest.prepareStep({
        stepNumber: 1,
        steps: [],
        model: { kind: 'model' },
        messages: [],
      }),
    ).toEqual({
      toolChoice: 'auto',
    })
    expect(context.debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_choice_preflight: 'required',
      experimental_agentic_transcript_recall_tool_choice_source: 'heuristic',
      experimental_agentic_transcript_recall_tool_choice_version: 'character-chat-v1-aggressive',
      experimental_agentic_transcript_recall_tool_choice_score: 7,
      experimental_agentic_transcript_recall_tool_choice_matches:
        'OLDER_PAST_REFERENCE,EXACT_RECALL,PROMISE_OR_BOUNDARY',
      experimental_agentic_transcript_recall_tool_choice_blocks: null,
      experimental_agentic_transcript_recall_tool_choice_applied: true,
    })
  })

  it('composes an existing experimental prepareStep with the first-step required tool override', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload()
    const context = buildContext({
      recentMessages: [
        { role: 'assistant', content: '지난 약속을 떠올리며 숨을 고른다.' },
        { role: 'user', content: '지난번에 한 약속 정확히 다시 말해줘.' },
      ],
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
      agenticTranscriptRecallSourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older promise',
          },
        ],
      },
      agenticTranscriptRecallSourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older promise',
          },
        ],
        navigationParents: [],
      },
      debugMetrics: {},
    })
    const existingPrepareStep = vi.fn().mockResolvedValue({
      system: 'FINAL\n\nExperimental',
      activeTools: ['fetch_source_range'],
    })

    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        system: 'FINAL\n\nExperimental',
        messages: context.recentMessages,
      },
      streamTextSettings: {
        tools: {
          fetch_source_range: {},
        },
        prepareStep: existingPrepareStep,
      },
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-force-required-compose',
      payload,
      context,
      timings: {},
    })

    const streamRequest = streamTextMock.mock.calls[0]?.[0]
    const firstStepArgs = {
      stepNumber: 0,
      steps: [],
      model: { kind: 'model' },
      messages: [],
    }
    const secondStepArgs = {
      stepNumber: 1,
      steps: [],
      model: { kind: 'model' },
      messages: [],
    }

    expect(streamRequest.prepareStep).toEqual(expect.any(Function))
    expect(await streamRequest.prepareStep(firstStepArgs)).toEqual({
      system: 'FINAL\n\nExperimental',
      activeTools: ['fetch_source_range'],
      toolChoice: 'required',
    })
    expect(await streamRequest.prepareStep(secondStepArgs)).toEqual({
      system: 'FINAL\n\nExperimental',
      activeTools: ['fetch_source_range'],
      toolChoice: 'auto',
    })
    expect(existingPrepareStep).toHaveBeenNthCalledWith(1, firstStepArgs)
    expect(existingPrepareStep).toHaveBeenNthCalledWith(2, secondStepArgs)
  })

  it('disables anthropic thinking when forced ATR tool choice is applied', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload({
      provider: 'anthropic',
      modelName: 'claude-opus-4-7',
    })
    const context = buildContext({
      recentMessages: [
        { role: 'assistant', content: '지난 약속을 떠올리며 숨을 고른다.' },
        { role: 'user', content: '지난번에 한 약속 정확히 다시 말해줘.' },
      ],
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
        providerAllowlist: ['anthropic'],
      },
      agenticTranscriptRecallSourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older promise',
          },
        ],
      },
      agenticTranscriptRecallSourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older promise',
          },
        ],
        navigationParents: [],
      },
      debugMetrics: {},
    })

    getProviderOptionsMock.mockReturnValueOnce({
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: 'medium',
        anthropicBeta: ['interleaved-thinking-2025-05-14'],
        cacheControl: { type: 'ephemeral', ttl: '1h' },
      },
    })
    buildStreamPayloadPlanMock.mockReturnValueOnce({
      strategy: 'anthropic-split-system',
      streamRequest: {
        messages: [{ role: 'user', content: 'Hello' }],
        providerOptions: {
          anthropic: {
            thinking: { type: 'adaptive' },
            effort: 'medium',
            anthropicBeta: ['interleaved-thinking-2025-05-14'],
            cacheControl: { type: 'ephemeral', ttl: '1h' },
          },
        },
      },
      actualPayload: {
        provider: 'anthropic',
        strategy: 'anthropic-split-system',
        systemMessages: [{ role: 'system', content: 'FINAL' }],
        conversationMessages: [{ role: 'user', content: 'Hello' }],
      },
    })
    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        messages: [{ role: 'user', content: 'Hello' }],
        providerOptions: {
          anthropic: {
            thinking: { type: 'adaptive' },
            effort: 'medium',
            anthropicBeta: ['interleaved-thinking-2025-05-14'],
            cacheControl: { type: 'ephemeral', ttl: '1h' },
          },
        },
      },
      streamTextSettings: {
        tools: {
          fetch_source_range: {},
        },
      },
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-anthropic-force-required',
      payload,
      context,
      timings: {},
    })

    const streamRequest = streamTextMock.mock.calls[0]?.[0]
    expect(streamRequest).toMatchObject({
      tools: {
        fetch_source_range: {},
      },
      providerOptions: {
        anthropic: {
          cacheControl: { type: 'ephemeral', ttl: '1h' },
        },
      },
    })
    expect(streamRequest).not.toHaveProperty('toolChoice', 'required')
    expect(streamRequest.prepareStep).toEqual(expect.any(Function))
    expect(
      await streamRequest.prepareStep({
        stepNumber: 0,
        steps: [],
        model: { kind: 'model' },
        messages: [],
      }),
    ).toEqual({
      toolChoice: 'required',
    })
    expect(
      await streamRequest.prepareStep({
        stepNumber: 1,
        steps: [],
        model: { kind: 'model' },
        messages: [],
      }),
    ).toEqual({
      toolChoice: 'auto',
    })
    expect(context.debugMetrics).toMatchObject({
      anthropic_thinking_requested: false,
      anthropic_thinking_type: null,
      anthropic_thinking_effort: null,
      anthropic_interleaved_thinking_requested: false,
      anthropic_thinking_disabled_for_required_tool_choice: true,
      experimental_agentic_transcript_recall_tool_choice_applied: true,
    })
  })

  it('forces required tool choice for older promise recall without exact-wording cues', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload()
    const context = buildContext({
      recentMessages: [
        { role: 'assistant', content: '희미하게 웃으며 지난 별명을 떠올린다.' },
        { role: 'user', content: '지난번 애칭 뭐였어?' },
      ],
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
      agenticTranscriptRecallSourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older nickname scene',
          },
        ],
      },
      agenticTranscriptRecallSourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older nickname scene',
          },
        ],
        navigationParents: [],
      },
      debugMetrics: {},
    })

    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        system: 'FINAL\n\nExperimental',
        messages: context.recentMessages,
      },
      streamTextSettings: {
        tools: {
          fetch_source_range: {},
        },
      },
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-force-promise-required',
      payload,
      context,
      timings: {},
    })

    const streamRequest = streamTextMock.mock.calls[0]?.[0]
    expect(streamRequest.prepareStep).toEqual(expect.any(Function))
    expect(
      await streamRequest.prepareStep({
        stepNumber: 0,
        steps: [],
        model: { kind: 'model' },
        messages: [],
      }),
    ).toEqual({
      toolChoice: 'required',
    })
    expect(context.debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_choice_preflight: 'required',
      experimental_agentic_transcript_recall_tool_choice_version: 'character-chat-v1-aggressive',
      experimental_agentic_transcript_recall_tool_choice_score: 4,
      experimental_agentic_transcript_recall_tool_choice_matches:
        'OLDER_PAST_REFERENCE,PROMISE_OR_BOUNDARY',
      experimental_agentic_transcript_recall_tool_choice_applied: true,
    })
  })

  it('restores anthropic thinking debug metrics when forced-tool ATR falls back to the standard request', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload({
      provider: 'anthropic',
      modelName: 'claude-opus-4-7',
    })
    const context = buildContext({
      recentMessages: [
        { role: 'assistant', content: '지난 약속을 떠올리며 숨을 고른다.' },
        { role: 'user', content: '지난번에 한 약속 정확히 다시 말해줘.' },
      ],
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
        providerAllowlist: ['anthropic'],
      },
      agenticTranscriptRecallSourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older promise',
          },
        ],
      },
      agenticTranscriptRecallSourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older promise',
          },
        ],
        navigationParents: [],
      },
      debugMetrics: {},
    })

    getProviderOptionsMock.mockReturnValueOnce({
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: 'medium',
        anthropicBeta: ['interleaved-thinking-2025-05-14'],
        cacheControl: { type: 'ephemeral', ttl: '1h' },
      },
    })
    buildStreamPayloadPlanMock.mockReturnValueOnce({
      strategy: 'anthropic-split-system',
      streamRequest: {
        messages: [{ role: 'user', content: 'Hello' }],
        providerOptions: {
          anthropic: {
            thinking: { type: 'adaptive' },
            effort: 'medium',
            anthropicBeta: ['interleaved-thinking-2025-05-14'],
            cacheControl: { type: 'ephemeral', ttl: '1h' },
          },
        },
      },
      actualPayload: {
        provider: 'anthropic',
        strategy: 'anthropic-split-system',
        systemMessages: [{ role: 'system', content: 'FINAL' }],
        conversationMessages: [{ role: 'user', content: 'Hello' }],
      },
    })
    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        messages: [{ role: 'user', content: 'Hello' }],
        providerOptions: {
          anthropic: {
            thinking: { type: 'adaptive' },
            effort: 'medium',
            anthropicBeta: ['interleaved-thinking-2025-05-14'],
            cacheControl: { type: 'ephemeral', ttl: '1h' },
          },
        },
      },
      streamTextSettings: {
        tools: {
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
      jobId: 'job-anthropic-force-required-fallback',
      payload,
      context,
      timings: {},
    })

    expect(streamTextMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        tools: {
          fetch_source_range: {},
        },
        providerOptions: {
          anthropic: {
            cacheControl: { type: 'ephemeral', ttl: '1h' },
          },
        },
      }),
    )
    expect(streamTextMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        providerOptions: {
          anthropic: {
            thinking: { type: 'adaptive' },
            effort: 'medium',
            anthropicBeta: ['interleaved-thinking-2025-05-14'],
            cacheControl: { type: 'ephemeral', ttl: '1h' },
          },
        },
      }),
    )
    expect(context.debugMetrics).toMatchObject({
      anthropic_thinking_requested: true,
      anthropic_thinking_type: 'adaptive',
      anthropic_thinking_effort: 'medium',
      anthropic_interleaved_thinking_requested: true,
      anthropic_thinking_disabled_for_required_tool_choice: false,
      experimental_agentic_transcript_recall_tool_choice_applied: false,
      experimental_agentic_transcript_recall_fallback_to_standard: true,
    })
  })

  it('keeps tool choice on auto for immediate continuation requests', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload()
    const context = buildContext({
      recentMessages: [
        { role: 'assistant', content: '조용히 손을 내민다.' },
        { role: 'user', content: '방금 그 말 다시 해줘.' },
      ],
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
      agenticTranscriptRecallSourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older detail',
          },
        ],
      },
      agenticTranscriptRecallSourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older detail',
          },
        ],
        navigationParents: [],
      },
      debugMetrics: {},
    })

    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        system: 'FINAL\n\nExperimental',
        messages: context.recentMessages,
      },
      streamTextSettings: {
        tools: {
          fetch_source_range: {},
        },
      },
    })

    await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-auto-continuation',
      payload,
      context,
      timings: {},
    })

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'FINAL\n\nExperimental',
        messages: context.recentMessages,
        tools: {
          fetch_source_range: {},
        },
      }),
    )
    expect(streamTextMock.mock.calls[0]?.[0]).not.toHaveProperty('toolChoice', 'required')
    expect(context.debugMetrics).toMatchObject({
      experimental_agentic_transcript_recall_tool_choice_preflight: 'auto',
      experimental_agentic_transcript_recall_tool_choice_blocks: 'IMMEDIATE_CONTINUATION',
      experimental_agentic_transcript_recall_tool_choice_applied: false,
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

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: { kind: 'model' },
        temperature: 0.7,
        system: 'FINAL',
        messages: [{ role: 'user', content: 'Hello' }],
        abortSignal: expect.any(AbortSignal),
      }),
    )
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
        conversationMessages: [
          { role: 'user', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
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
      toolContract: null,
      ttlSeconds: 60,
    })
    expect(buildStreamPayloadPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        googleExplicitCache: expect.objectContaining({
          googleExplicitCacheEnabled: true,
          googleCacheDecision: { enabled: true, minTokens: 1024 },
          googleCacheResult: {
            success: true,
            cacheName: 'cache-1',
            cachedTokenCount: 2048,
          },
          streamRequestOverride: expect.objectContaining({
            messages: [{ role: 'user', content: 'Last message' }],
          }),
          cacheDebugInfo: {
            systemPrompt: 'FINAL',
            cacheName: 'cache-1',
            cachedTokenCount: 2048,
            messagesToCache: [{ role: 'user', content: 'Older context' }],
          },
        }),
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

  it('keeps google ATR tool-capable turns cacheable when a tool contract can be mirrored into cache creation', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload({
      provider: 'google',
      modelName: 'gemini-2.5-flash',
    })
    const context = buildContext({
      recentMessages: [
        { role: 'assistant', content: 'Older context' },
        { role: 'user', content: 'Last message' },
      ],
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
      agenticTranscriptRecallSourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older context',
          },
        ],
      },
      agenticTranscriptRecallSourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older context',
          },
        ],
        navigationParents: [],
      },
      debugMetrics: {},
    })

    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    createGoogleCacheMock.mockResolvedValueOnce({
      success: true,
      cacheName: 'cache-tools-1',
      cachedTokenCount: 2048,
    })
    buildStreamPayloadPlanMock.mockReturnValueOnce({
      strategy: 'google-explicit-cache',
      streamRequest: {
        messages: [{ role: 'user', content: 'Last message' }],
        providerOptions: {
          google: {
            cachedContent: 'cache-tools-1',
            rebelCachedContentOwnsRequestContract: true,
          },
        },
      },
      actualPayload: {
        provider: 'google',
        strategy: 'google-explicit-cache',
        systemMessages: [{ role: 'system', content: 'FINAL' }],
        conversationMessages: [
          { role: 'assistant', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
        cache: {
          cacheName: 'cache-tools-1',
          cachedTokenCount: 2048,
        },
      },
    })
    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        messages: [{ role: 'user', content: 'Last message' }],
        providerOptions: {
          google: {
            cachedContent: 'cache-tools-1',
            rebelCachedContentOwnsRequestContract: true,
          },
        },
      },
      streamTextSettings: {
        tools: {
          fetch_source_range: {},
        },
      },
    })

    const result = await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-google-tools-preflight',
      payload,
      context,
      timings: {},
    })

    expect(createGoogleCacheMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        modelName: 'gemini-2.5-flash',
        systemPrompt: expect.stringContaining('Experimental Transcript Recall'),
        messagesToCache: [{ role: 'assistant', content: 'Older context' }],
        toolContract: expect.objectContaining({
          tools: expect.arrayContaining([expect.objectContaining({ name: 'fetch_source_range' })]),
        }),
        ttlSeconds: 60,
      }),
    )
    expect(buildStreamPayloadPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        googleExplicitCache: expect.objectContaining({
          googleExplicitCacheEnabled: true,
          googleCacheDecision: { enabled: true, minTokens: 1024 },
          googleCacheResult: {
            success: true,
            cacheName: 'cache-tools-1',
            cachedTokenCount: 2048,
          },
          disabledForToolUsePreflight: false,
        }),
      }),
    )
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: 'Last message' }],
        providerOptions: {
          google: {
            cachedContent: 'cache-tools-1',
            rebelCachedContentOwnsRequestContract: true,
          },
        },
        tools: {
          fetch_source_range: {},
        },
      }),
    )
    const streamRequest = streamTextMock.mock.calls[0]?.[0] as {
      prepareStep?: unknown
    }
    expect(streamRequest.prepareStep).toBeUndefined()
    expect(result).toMatchObject({
      status: 'streaming',
      googleExplicitCacheEnabled: true,
      googleCacheDecision: { enabled: true, minTokens: 1024 },
      googleCacheResult: {
        success: true,
        cacheName: 'cache-tools-1',
        cachedTokenCount: 2048,
      },
      actualPayload: expect.objectContaining({
        strategy: 'google-explicit-cache',
      }),
    })
    expect(context.debugMetrics).toMatchObject({
      google_explicit_cache_disabled_for_tool_use_preflight: false,
      google_explicit_cache_disabled_for_compatibility_retry: false,
      experimental_agentic_transcript_recall_wrapper_used: true,
      experimental_agentic_transcript_recall_fallback_to_standard: false,
      experimental_agentic_transcript_recall_tool_choice_applied: false,
    })
  })

  it('keeps google ATR tool-capable turns on the uncached core path when explicit cache is off', async () => {
    const { requestProviderStage } = await import('./provider-request-stage')
    const payload = buildPayload({
      provider: 'google',
      modelName: 'gemini-2.5-flash',
    })
    const context = buildContext({
      recentMessages: [
        { role: 'assistant', content: 'Older context' },
        { role: 'user', content: 'Last message' },
      ],
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
      agenticTranscriptRecallSourceHints: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        hints: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older context',
          },
        ],
      },
      agenticTranscriptRecallSourceMap: {
        rawContextStartOrdinal: 21,
        cutoffOrdinal: 20,
        directFetchRanges: [
          {
            kind: 'summary',
            label: 'summary',
            startSeq: 1,
            endSeq: 10,
            preview: 'Older context',
          },
        ],
        navigationParents: [],
      },
      debugMetrics: {},
    })

    isGoogleExplicitCacheEnabledMock.mockReturnValueOnce(false)
    resolveGoogleCacheDecisionMock.mockReturnValueOnce({ enabled: true, minTokens: 1024 })
    buildStreamPayloadPlanMock.mockReturnValueOnce({
      strategy: 'default',
      streamRequest: {
        system: 'FINAL',
        messages: [
          { role: 'assistant', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
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
    prepareExperimentalAgenticTranscriptRecallRequestMock.mockReturnValueOnce({
      streamRequest: {
        system: 'FINAL\n\nExperimental',
        messages: [
          { role: 'assistant', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
      },
      streamTextSettings: {
        tools: {
          fetch_source_range: {},
        },
      },
    })

    const result = await requestProviderStage({
      supabase: createChatJobRunnerSupabaseMock() as never,
      jobId: 'job-google-tools-off',
      payload,
      context,
      timings: {},
    })

    expect(createGoogleCacheMock).not.toHaveBeenCalled()
    expect(buildStreamPayloadPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        googleExplicitCache: expect.objectContaining({
          googleExplicitCacheEnabled: false,
          googleCacheDecision: { enabled: true, minTokens: 1024 },
          googleCacheResult: null,
          disabledForToolUsePreflight: false,
          disabledForCompatibilityRetry: false,
          streamRequestOverride: null,
        }),
      }),
    )
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'FINAL\n\nExperimental',
        messages: [
          { role: 'assistant', content: 'Older context' },
          { role: 'user', content: 'Last message' },
        ],
        tools: {
          fetch_source_range: {},
        },
      }),
    )
    expect(result).toMatchObject({
      status: 'streaming',
      googleExplicitCacheEnabled: false,
      googleCacheDecision: { enabled: true, minTokens: 1024 },
      googleCacheResult: null,
      actualPayload: expect.objectContaining({
        strategy: 'default',
      }),
    })
    expect(context.debugMetrics).toMatchObject({
      google_explicit_cache_disabled_for_tool_use_preflight: false,
      google_explicit_cache_disabled_for_compatibility_retry: false,
      experimental_agentic_transcript_recall_wrapper_used: true,
      experimental_agentic_transcript_recall_fallback_to_standard: false,
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
        googleExplicitCache: expect.objectContaining({
          googleExplicitCacheEnabled: false,
          googleCacheDecision: { enabled: true, minTokens: 1024 },
          googleCacheResult: null,
          disabledForCompatibilityRetry: true,
        }),
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
