import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateText, jsonSchema, stepCountIs, streamText, tool } from 'ai'
import { readDeepSeekUsageStep } from './deepseek-usage'
import { priceUsageSteps } from './usage'
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
  countProjectedConversationMessages: mocks.count,
}))
vi.mock('@/app/api/internal/chat-job-runner/post-generation-pipeline', () => ({
  runPostGenerationPipeline: mocks.pipeline,
}))
vi.mock('@/app/api/internal/chat-job-runner/assistant-stream-broadcaster', () => ({
  broadcastAssistantStreamSnapshot: vi.fn().mockResolvedValue(undefined),
  broadcastAssistantStreamError: vi.fn().mockResolvedValue(undefined),
}))
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => {
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

const first = {
  prompt_tokens: 9000,
  completion_tokens: 300,
  total_tokens: 9300,
  prompt_cache_hit_tokens: 6000,
  prompt_cache_miss_tokens: 3000,
  completion_tokens_details: { reasoning_tokens: 100 },
}
const last = {
  prompt_tokens: 10000,
  completion_tokens: 1500,
  total_tokens: 11500,
  prompt_cache_hit_tokens: 8000,
  prompt_cache_miss_tokens: 2000,
  completion_tokens_details: { reasoning_tokens: 500 },
}

function sse({
  isTool = false,
  usage = isTool ? first : last,
  model = 'deepseek-flash',
  created = '2026-10-16T12:00:00Z',
}: {
  isTool?: boolean
  usage?: Record<string, unknown> | null
  model?: string | null
  created?: string | null
} = {}) {
  const base = {
    id: isTool ? 'first' : 'last',
    object: 'chat.completion.chunk',
    ...(created ? { created: Date.parse(created) / 1000 } : {}),
    ...(model ? { model } : {}),
    system_fingerprint: 'test',
  }
  const events = [
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', reasoning_content: '검증용 추론입니다.' },
          finish_reason: null,
        },
      ],
    },
    {
      ...base,
      choices: [
        {
          index: 0,
          delta: isTool
            ? {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call-1',
                    type: 'function',
                    function: { name: 'fetch_source_range', arguments: '{}' },
                  },
                ],
              }
            : { content: '이전 대화를 확인했습니다.' },
          finish_reason: isTool ? 'tool_calls' : 'stop',
        },
      ],
    },
    { ...base, choices: [], ...(usage ? { usage } : {}) },
  ]
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

async function makeStream(
  fetchMock: ReturnType<typeof vi.fn>,
  modelName = 'deepseek-v4-flash',
  atr = false,
) {
  vi.stubGlobal('fetch', fetchMock)
  const { buildLanguageModel } = await import('@/lib/llm/model-factory')
  return streamText({
    model: buildLanguageModel({ provider: 'deepseek', modelName, apiKey: 'fake-test-key' }),
    prompt: '이전 대화를 확인해주세요.',
    maxRetries: 0,
    ...(atr
      ? {
          tools: {
            fetch_source_range: tool({
              description: 'Read earlier messages',
              inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
              execute: async () => ({ messages: ['Earlier conversation'] }),
            }),
          },
          stopWhen: stepCountIs(2),
        }
      : {}),
  })
}

async function persistAndRead(stream: unknown, modelName = 'deepseek-v4-flash') {
  const collected = await consumeStreamingResponseStage({
    supabase: {} as never,
    chatId: 'chat',
    jobId: 'job',
    stream: stream as never,
    provider: 'deepseek',
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
      provider: 'deepseek',
      modelName,
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
  mocks.latest.mockResolvedValue({
    id: 'answer',
    created_at: '2026-10-16T12:00:00Z',
    debug_info: { usageOnly: true, usageReceipt: saved.debugInfo.usageReceipt },
  })
  const response = await GET(new Request('http://local/stats'), {
    params: Promise.resolve({ chatId: 'chat' }),
  })
  return { collected, saved, stats: parseLatestUsageStatsResponse(await response.json())! }
}

it.each([
  ['deepseek-flash', '2026-10-16T12:00:00Z', 'off_peak', 0.001224],
  ['deepseek-flash', '2026-10-16T03:00:00Z', 'peak', 0.002448],
  ['deepseek-v4-pro', '2026-10-16T12:00:00Z', 'off_peak', 0.004466],
  ['deepseek-v4-pro', '2026-10-16T03:00:00Z', 'peak', 0.008932],
] as const)(
  'retains SDK usage and prices %s at %s through the pruned receipt and stats UI',
  async (modelName, created, pricingPeriod, total) => {
    const fetchMock = vi.fn().mockResolvedValue(sse({ model: modelName, created }))
    const stream = await makeStream(fetchMock, modelName)
    const { collected, saved, stats } = await persistAndRead(stream, modelName)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(collected.usageSteps?.[0]).toMatchObject({
      modelName,
      pricingTimestamp: new Date(created).toISOString(),
    })
    expect(stats).toMatchObject({
      prompt: 10000,
      uncachedPrompt: 2000,
      cachedPrompt: 8000,
      completion: 1000,
      reasoning: 500,
      total: 11500,
      callCount: 1,
      pricingPeriod,
      billingModels: [modelName],
      usageBreakdownAvailable: true,
    })
    expect(stats.costUsd).toBeCloseTo(total, 12)
    expect(
      Object.entries(saved.debugInfo.usageReceipt.cost)
        .filter(([key]) => key !== 'total')
        .reduce((sum, [, value]) => sum + Number(value ?? 0), 0),
    ).toBeCloseTo(total, 12)
    expect(stats.completionCostUsd).toBeCloseTo(stats.reasoningCostUsd! * 2, 12)
  },
)

it('uses a returned Flash model when a Pro request is routed to Flash', async () => {
  const stream = await makeStream(vi.fn().mockResolvedValue(sse()), 'deepseek-v4-pro')
  const { stats } = await persistAndRead(stream, 'deepseek-v4-pro')
  expect(stats.modelName).toBe('deepseek-v4-pro')
  expect(stats.billingModels).toEqual(['deepseek-flash'])
  expect(stats.costUsd).toBeCloseTo(0.001224, 12)
})

it('aggregates two real ATR calls using their respective peak/off-peak periods', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(sse({ isTool: true, created: '2026-10-16T03:59:00Z' }))
    .mockResolvedValueOnce(sse({ created: '2026-10-16T04:01:00Z' }))
  const stream = await makeStream(fetchMock, 'deepseek-v4-flash', true)
  const { stats } = await persistAndRead(stream)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(stats).toMatchObject({
    callCount: 2,
    prompt: 19000,
    uncachedPrompt: 5000,
    cachedPrompt: 14000,
    completion: 1200,
    reasoning: 600,
    total: 20800,
    pricingPeriod: 'mixed',
  })
  expect(stats.costUsd).toBeCloseTo(0.00252, 12)
})

it('keeps a saved price stable when the panel is read at a different pricing time', async () => {
  const stream = await makeStream(vi.fn().mockResolvedValue(sse()))
  const { stats } = await persistAndRead(stream)
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2026-10-19T02:00:00Z'))
    const response = await GET(new Request('http://local/stats'), {
      params: Promise.resolve({ chatId: 'chat' }),
    })
    expect((await response.json()).latestMessage.costUsd).toBe(stats.costUsd)
  } finally {
    vi.useRealTimers()
  }
})

it.each([
  { usage: null },
  { usage: { prompt_tokens: 10000, completion_tokens: 1500, total_tokens: 11500 } },
  { created: null },
  { model: null },
  { model: 'unknown-future-model' },
  { created: '2027-10-15T02:00:00Z' },
])(
  'does not invent costs for incomplete usage, native metadata, or future calendars: %j',
  async (args) => {
    const stream = await makeStream(vi.fn().mockResolvedValue(sse(args)))
    const { stats } = await persistAndRead(stream)
    expect(stats.costUsd).toBeNull()
  },
)

it('keeps partial ATR usage unknown instead of displaying only the known call', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(sse({ isTool: true }))
    .mockResolvedValueOnce(sse({ usage: null }))
  const stream = await makeStream(fetchMock, 'deepseek-v4-flash', true)
  const { stats } = await persistAndRead(stream)
  expect(stats.callCount).toBe(2)
  expect(stats.prompt).toBeNull()
  expect(stats.costUsd).toBeNull()
})

it('prices known inclusive output without inventing an omitted reasoning breakdown', async () => {
  const stream = await makeStream(
    vi.fn().mockResolvedValue(sse({ usage: { ...last, completion_tokens_details: undefined } })),
  )
  const { stats } = await persistAndRead(stream)
  expect(stats.costUsd).toBeCloseTo(0.001224, 12)
  expect(stats.completion).toBeNull()
  expect(stats.reasoning).toBeNull()
  expect(stats.completionCostUsd).toBeNull()
  expect(stats.reasoningCostUsd).toBeNull()
  expect(stats.total).toBe(11500)
})

it('derives cache hits from the reported miss count when the native hit counter is absent', async () => {
  const stream = await makeStream(
    vi.fn().mockResolvedValue(sse({ usage: { ...last, prompt_cache_hit_tokens: undefined } })),
  )
  const { stats } = await persistAndRead(stream)
  expect(stats).toMatchObject({ cachedPrompt: 8000, uncachedPrompt: 2000, cacheHit: true })
  expect(stats.costUsd).toBeCloseTo(0.001224, 12)
})

it('retains the native metadata for non-streaming SDK generation too', async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: 'answer',
        object: 'chat.completion',
        created: Date.parse('2026-10-16T12:00:00Z') / 1000,
        model: 'deepseek-flash',
        system_fingerprint: 'test',
        usage: last,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Answer', reasoning_content: 'Thinking' },
            finish_reason: 'stop',
          },
        ],
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  )
  vi.stubGlobal('fetch', fetchMock)
  const { buildLanguageModel } = await import('./model-factory')
  const result = await generateText({
    model: buildLanguageModel({
      provider: 'deepseek',
      modelName: 'deepseek-v4-pro',
      apiKey: 'fake-test-key',
    }),
    prompt: 'Test',
    maxRetries: 0,
  })
  const step = readDeepSeekUsageStep(result.steps[0])
  expect(step).toMatchObject({
    modelName: 'deepseek-flash',
    pricingTimestamp: '2026-10-16T12:00:00.000Z',
  })
  expect(
    priceUsageSteps({ provider: 'deepseek', modelName: 'deepseek-v4-pro', steps: [step] })
      ?.totalCost,
  ).toBeCloseTo(0.001224, 12)
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('deepseek-v4-pro')
})
