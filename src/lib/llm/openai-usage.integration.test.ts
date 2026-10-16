import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { jsonSchema, stepCountIs, streamText, tool } from 'ai'
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
  input_tokens: 9000,
  output_tokens: 300,
  input_tokens_details: { cached_tokens: 6000, cache_write_tokens: 1000 },
  output_tokens_details: { reasoning_tokens: 100 },
}
const last = {
  input_tokens: 10000,
  output_tokens: 1500,
  input_tokens_details: { cached_tokens: 8000, cache_write_tokens: 1000 },
  output_tokens_details: { reasoning_tokens: 500 },
}
function sse(tier = 'default', isTool = false, omitFinish = false) {
  const item = isTool
    ? {
        type: 'function_call',
        id: 'fc_1',
        call_id: 'call_1',
        name: 'fetch_source_range',
        arguments: '{}',
        status: 'completed',
      }
    : {
        type: 'message',
        id: 'msg_1',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '이전 대화를 확인했습니다.', annotations: [] }],
      }
  const events: Record<string, unknown>[] = [
    {
      type: 'response.created',
      response: {
        id: isTool ? 'resp_1' : 'resp_2',
        created_at: 0,
        model: 'gpt-6.1-sol',
        service_tier: tier,
      },
    },
    { type: 'response.output_item.added', output_index: 0, item },
  ]
  events.push(
    isTool
      ? {
          type: 'response.function_call_arguments.delta',
          item_id: 'fc_1',
          output_index: 0,
          delta: '{}',
        }
      : {
          type: 'response.output_text.delta',
          item_id: 'msg_1',
          output_index: 0,
          content_index: 0,
          delta: '이전 대화를 확인했습니다.',
        },
  )
  events.push({ type: 'response.output_item.done', output_index: 0, item })
  if (!omitFinish)
    events.push({
      type: 'response.completed',
      response: { usage: isTool ? first : last, service_tier: tier },
    })
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

async function makeStream(
  fetchMock: ReturnType<typeof vi.fn>,
  tier: 'standard' | 'flex' | 'priority',
  atr = false,
) {
  // The app's tier fetch captures global fetch at import time. Reset AFTER
  // installing the mock, ensuring even Flex/Priority never makes a real request.
  vi.stubGlobal('fetch', fetchMock)
  vi.resetModules()
  const { buildLanguageModel } = await import('@/lib/llm/model-factory')
  return streamText({
    model: buildLanguageModel({
      provider: 'openai',
      modelName: 'gpt-6.1-sol',
      apiKey: 'fake-test-key',
      serviceTier: tier,
    }),
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
async function persistAndRead(stream: unknown, tier: 'standard' | 'flex' | 'priority') {
  const collected = await consumeStreamingResponseStage({
    supabase: {} as never,
    chatId: 'chat',
    jobId: 'job',
    stream: stream as never,
    provider: 'openai',
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
      provider: 'openai',
      modelName: 'gpt-6.1-sol',
    } as never,
    origin: 'http://local',
    context: {
      apiKeyData: { service_tier: tier },
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
    created_at: '2026-10-16T00:00:00Z',
    debug_info: { usageOnly: true, usageReceipt: saved.debugInfo.usageReceipt },
  })
  const response = await GET(new Request('http://local/stats'), {
    params: Promise.resolve({ chatId: 'chat' }),
  })
  return { collected, saved, stats: parseLatestUsageStatsResponse(await response.json())! }
}

it.each(['standard', 'flex'] as const)(
  'retains every SDK ATR call and billing category through %s stats',
  async (tier) => {
    const actualTier = tier === 'standard' ? 'default' : tier
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sse(actualTier, true))
      .mockResolvedValueOnce(sse(actualTier))
    const stream = await makeStream(fetchMock, tier, true)
    const { collected, saved, stats } = await persistAndRead(stream, tier)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(collected.usageSteps).toHaveLength(2)
    expect(stats).toMatchObject({
      callCount: 2,
      serviceTier: tier,
      prompt: 19000,
      uncachedPrompt: 3000,
      cachedPrompt: 14000,
      cacheWrite: 2000,
      completion: 1200,
      reasoning: 600,
      total: 20800,
      usageBreakdownAvailable: true,
    })
    const multiplier = tier === 'flex' ? 0.5 : 1
    expect(stats.costUsd).toBeCloseTo(0.0304 * multiplier, 12)
    expect(stats.cacheWriteCostUsd).toBeCloseTo(0.005 * multiplier, 12)
    expect(stats.promptCostUsd).toBeCloseTo(0.006 * multiplier, 12)
    expect(stats.completionCostUsd).toBeCloseTo(0.012 * multiplier, 12)
    expect(stats.reasoningCostUsd).toBeCloseTo(0.006 * multiplier, 12)
    expect(
      Object.entries(saved.debugInfo.usageReceipt.cost)
        .filter(([key]) => key !== 'total')
        .reduce((sum, [, cost]) => sum + Number(cost ?? 0), 0),
    ).toBeCloseTo(stats.costUsd!, 12)
  },
)

it.each([
  ['flex', 'default', 'standard', 0.0203],
  ['priority', 'priority', 'priority', 0.0406],
  ['priority', 'fast', 'priority', 0.0406],
] as const)('prices requested %s using returned %s', async (requested, returned, actual, cost) => {
  const stream = await makeStream(vi.fn().mockResolvedValue(sse(returned)), requested)
  const { stats } = await persistAndRead(stream, requested)
  expect(stats.serviceTier).toBe(actual)
  expect(stats.costUsd).toBeCloseTo(cost, 12)
  expect(stats.completion).toBe(1000)
  expect(stats.reasoning).toBe(500)
})

it('prices each ATR call using its own returned mode', async () => {
  const stream = await makeStream(
    vi.fn().mockResolvedValueOnce(sse('flex', true)).mockResolvedValueOnce(sse('default')),
    'flex',
    true,
  )
  const { stats } = await persistAndRead(stream, 'flex')
  expect(stats.serviceTier).toBe('mixed')
  expect(stats.costUsd).toBeCloseTo(0.00505 + 0.0203, 12)
})

it('retains numeric usage but leaves an unknown returned billing mode unpriced', async () => {
  const stream = await makeStream(vi.fn().mockResolvedValue(sse('scale')), 'standard')
  const { stats } = await persistAndRead(stream, 'standard')
  expect(stats.serviceTier).toBe('unknown')
  expect(stats.prompt).toBe(10000)
  expect(stats.costUsd).toBeNull()
})

it('keeps a completed text stream without usage unknown instead of free', async () => {
  const stream = await makeStream(
    vi.fn().mockResolvedValue(sse('default', false, true)),
    'standard',
  )
  const { stats } = await persistAndRead(stream, 'standard')
  expect(stats.prompt).toBeNull()
  expect(stats.completion).toBeNull()
  expect(stats.reasoning).toBeNull()
  expect(stats.cacheWrite).toBeNull()
  expect(stats.costUsd).toBeNull()
})

it('does not present a partial ATR receipt as the full answer price', async () => {
  const stream = await makeStream(
    vi
      .fn()
      .mockResolvedValueOnce(sse('default', true))
      .mockResolvedValueOnce(sse('default', false, true)),
    'standard',
    true,
  )
  const { stats } = await persistAndRead(stream, 'standard')
  expect(stats.callCount).toBe(2)
  expect(stats.prompt).toBeNull()
  expect(stats.costUsd).toBeNull()
})
