import { readGoogleUsageStep } from './google-usage'
import { priceUsageSteps } from './usage'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateText, jsonSchema, stepCountIs, streamText, tool } from 'ai'
import { buildLanguageModel } from './model-factory'
import { getProviderOptions } from './provider-options'
import { consumeStreamingResponseStage } from '@/app/api/internal/chat-job-runner/streaming-response-stage'
import { runPostProcessingStage } from '@/app/api/internal/chat-job-runner/post-processing-stage'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import { GET } from '@/app/api/chats/[chatId]/stats/route'
import { parseLatestUsageStatsResponse } from '@/app/dashboard/chats/[id]/hooks/useChatUsageStats'

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  latest: vi.fn(),
  count: vi.fn(),
  pipeline: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }))
vi.mock('@/lib/chat/turns', () => ({
  loadLatestProjectedAssistantMessage: mocks.latest,
  countProjectedChatMessages: mocks.count,
}))
vi.mock('@/app/api/internal/chat-job-runner/post-generation-pipeline', () => ({
  runPostGenerationPipeline: mocks.pipeline,
}))
vi.mock('@/app/api/internal/chat-job-runner/assistant-stream-broadcaster', () => ({
  broadcastAssistantStreamSnapshot: vi.fn().mockResolvedValue(undefined),
  broadcastAssistantStreamError: vi.fn().mockResolvedValue(undefined),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime('2026-10-16T00:00:00Z')
  vi.clearAllMocks()
  const db = createSupabaseMock({
    tables: {
      chats: { rows: [{ id: 'chat', user_id: 'owner' }] },
      chat_summaries: { rows: [] },
      chat_usage_events: { rows: [] },
    },
  })
  mocks.client.mockResolvedValue({
    ...db,
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } } }) },
  })
  mocks.count.mockResolvedValue(42)
  mocks.pipeline.mockResolvedValue({
    messageInsertDuration: null,
    usageEventInsertDurationMs: 0,
    summaryTriggerDurationMs: null,
  })
})

function sse(tier: 'standard' | 'flex', isTool = false, missingUsage = false) {
  const chunk = {
    candidates: [
      {
        content: {
          role: 'model',
          parts: isTool
            ? [
                {
                  functionCall: { name: 'fetch_source_range', args: {} },
                  thoughtSignature: 'signature',
                },
              ]
            : [{ text: '이전 대화를 확인했습니다.' }],
        },
        finishReason: 'STOP',
      },
    ],
    ...(!missingUsage
      ? {
          usageMetadata: isTool
            ? {
                promptTokenCount: 9000,
                candidatesTokenCount: 200,
                thoughtsTokenCount: 100,
                cachedContentTokenCount: 6000,
                totalTokenCount: 9300,
                serviceTier: tier,
              }
            : {
                promptTokenCount: 10000,
                candidatesTokenCount: 1500,
                thoughtsTokenCount: 500,
                cachedContentTokenCount: 8000,
                totalTokenCount: 12000,
                serviceTier: tier,
              },
        }
      : {}),
  }
  return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function persistAndRead(stream: unknown, queuedTier: 'standard' | 'flex') {
  const collected = await consumeStreamingResponseStage({
    supabase: {} as never,
    chatId: 'chat',
    jobId: 'job',
    stream: stream as never,
    provider: 'google',
    regenerateAssistantMessageId: null,
    providerAbortSignal: new AbortController().signal,
    providerStreamTimeoutMs: 240000,
  })
  await runPostProcessingStage({
    supabase: {} as never,
    payload: {
      requestId: 'request',
      chatId: 'chat',
      userId: 'owner',
      apiKeyId: 'key',
      provider: 'google',
      modelName: 'gemini-4-argon',
      serviceTier: queuedTier,
    } as never,
    origin: 'http://local',
    context: {
      apiKeyData: { service_tier: 'standard' },
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
    providerArtifacts: {
      promptCache: null,
      anthropicCache: null,
      googleExplicitCacheEnabled: false,
      googleCacheDecision: null,
      googleCacheResult: null,
      actualPayload: null,
    },
    streamingResponse: collected,
  })
  const saved = mocks.pipeline.mock.calls[0][0]
  // Exercise the small retained receipt, after the heavy debug payload is pruned.
  mocks.latest.mockResolvedValue({
    id: 'answer',
    created_at: '2026-10-16T00:00:00Z',
    debug_info: { usageOnly: true, usageReceipt: saved.debugInfo.usageReceipt },
  })
  const response = await GET(new Request('http://local/stats'), {
    params: Promise.resolve({ chatId: 'chat' }),
  })
  return { collected, saved, stats: parseLatestUsageStatsResponse(await response.json())! }
}

it.each(['standard', 'flex'] as const)(
  'retains every real SDK ATR call and thinking count through the %s stats response',
  async (tier) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sse(tier, true))
      .mockResolvedValueOnce(sse(tier))
    vi.stubGlobal('fetch', fetchMock)
    const execute = vi.fn(async () => ({ messages: ['Earlier conversation'] }))
    const stream = streamText({
      model: buildLanguageModel({
        provider: 'google',
        modelName: 'gemini-4-argon',
        apiKey: 'test-key',
      }),
      prompt: '이전 대화를 확인해주세요.',
      tools: {
        fetch_source_range: tool({
          description: 'Read earlier messages',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
          execute,
        }),
      },
      stopWhen: stepCountIs(2),
      maxRetries: 0,
      providerOptions: getProviderOptions('google', { serviceTier: tier }),
    })
    const { collected, stats } = await persistAndRead(stream, tier)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(collected.usageSteps).toHaveLength(2)
    expect(stats).toMatchObject({
      provider: 'google',
      callCount: 2,
      serviceTier: tier,
      prompt: 19000,
      uncachedPrompt: 5000,
      completion: 1700,
      cachedPrompt: 14000,
      reasoning: 600,
      total: 21300,
      cacheHit: true,
    })
    expect(stats.costUsd).toBeCloseTo(tier === 'standard' ? 0.0344 : 0.0172, 12)
    expect(
      (stats.promptCostUsd ?? 0) +
        (stats.completionCostUsd ?? 0) +
        (stats.cachedPromptCostUsd ?? 0) +
        (stats.reasoningCostUsd ?? 0),
    ).toBeCloseTo(stats.costUsd!, 12)
  },
)

it('uses each returned tier even when they differ from the queued selection', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce(sse('flex', true)).mockResolvedValueOnce(sse('standard')),
  )
  const stream = streamText({
    model: buildLanguageModel({
      provider: 'google',
      modelName: 'gemini-4-argon',
      apiKey: 'test-key',
    }),
    prompt: 'Read prior messages',
    tools: {
      fetch_source_range: tool({
        description: 'Read',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => ({ messages: [] }),
      }),
    },
    stopWhen: stepCountIs(2),
    maxRetries: 0,
    providerOptions: getProviderOptions('google', { serviceTier: 'flex' }),
  })
  const { stats } = await persistAndRead(stream, 'flex')
  expect(stats.serviceTier).toBe('mixed')
  expect(stats.costUsd).toBeCloseTo(0.0048 + 0.0248, 12)
})

it('shows unknown cost when the actual SDK receives text without usage metadata', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('standard', false, true)))
  const stream = streamText({
    model: buildLanguageModel({
      provider: 'google',
      modelName: 'gemini-4-argon',
      apiKey: 'test-key',
    }),
    prompt: 'Hello',
    maxRetries: 0,
  })
  const { saved, stats } = await persistAndRead(stream, 'standard')
  expect(saved.usageCost).toBeNull()
  expect(saved.debugInfo.usageReceipt.cost).toBeNull()
  expect(stats).toMatchObject({
    prompt: null,
    completion: null,
    reasoning: null,
    total: null,
    costUsd: null,
  })
})

it('does not display only the known call price when an earlier ATR call omits usage', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(sse('standard', true, true))
      .mockResolvedValueOnce(sse('standard')),
  )
  const stream = streamText({
    model: buildLanguageModel({
      provider: 'google',
      modelName: 'gemini-4-argon',
      apiKey: 'test-key',
    }),
    prompt: 'Read prior messages',
    tools: {
      fetch_source_range: tool({
        description: 'Read',
        inputSchema: jsonSchema({ type: 'object', properties: {} }),
        execute: async () => ({ messages: [] }),
      }),
    },
    stopWhen: stepCountIs(2),
    maxRetries: 0,
  })
  const { stats } = await persistAndRead(stream, 'standard')
  expect(stats).toMatchObject({ callCount: 2, prompt: null, completion: null, costUsd: null })
})

it.each(['standard', 'flex'] as const)(
  'prices real SDK ATR calls across the Argon discount cutoff and keeps the saved %s bill stable',
  async (tier) => {
    vi.setSystemTime('2026-11-30T23:59:59.999Z')
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        vi.setSystemTime('2026-12-01T00:00:00Z')
        return sse(tier, true)
      })
      .mockResolvedValueOnce(sse(tier))
    vi.stubGlobal('fetch', fetchMock)
    const stream = streamText({
      model: buildLanguageModel({
        provider: 'google',
        modelName: 'gemini-4-argon',
        apiKey: 'test-key',
      }),
      prompt: 'Read earlier messages.',
      tools: {
        fetch_source_range: tool({
          description: 'Read messages',
          inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
          execute: async () => ({ messages: ['Earlier conversation'] }),
        }),
      },
      stopWhen: stepCountIs(2),
      maxRetries: 0,
    })
    const { collected, stats } = await persistAndRead(stream, tier)
    expect(collected.usageSteps?.map((step) => step.pricingTimestamp)).toEqual([
      '2026-11-30T23:59:59.999Z',
      '2026-12-01T00:00:00.000Z',
    ])
    expect(stats.costUsd).toBeCloseTo(tier === 'standard' ? 0.0592 : 0.0296, 12)
    vi.setSystemTime('2027-02-01T00:00:00Z')
    const later = await GET(new Request('http://local/stats'), {
      params: Promise.resolve({ chatId: 'chat' }),
    })
    expect(parseLatestUsageStatsResponse(await later.json())?.costUsd).toBe(stats.costUsd)
  },
)

it('captures the request time for non-streaming Google responses even without tier metadata', async () => {
  vi.setSystemTime('2026-12-01T00:00:00Z')
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { role: 'model', parts: [{ text: 'Hello' }] }, finishReason: 'STOP' },
          ],
          usageMetadata: {
            promptTokenCount: 10000,
            candidatesTokenCount: 1000,
            thoughtsTokenCount: 500,
            cachedContentTokenCount: 8000,
            totalTokenCount: 11500,
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  )
  const result = await generateText({
    model: buildLanguageModel({
      provider: 'google',
      modelName: 'gemini-4-argon',
      apiKey: 'test-key',
    }),
    prompt: 'Hello',
    maxRetries: 0,
  })
  const step = readGoogleUsageStep(result)
  expect(step.pricingTimestamp).toBe('2026-12-01T00:00:00.000Z')
  expect(
    priceUsageSteps({ provider: 'google', modelName: 'gemini-4-argon', steps: [step] })?.totalCost,
  ).toBeCloseTo(0.0396, 12)
})
