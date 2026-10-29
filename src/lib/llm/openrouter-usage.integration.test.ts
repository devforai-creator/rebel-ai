import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { generateText, jsonSchema, stepCountIs, streamText, tool } from 'ai'
import { buildLanguageModel } from './model-factory'
import { consumeStreamingResponseStage } from '@/app/api/internal/chat-job-runner/streaming-response-stage'
import { runPostProcessingStage } from '@/app/api/internal/chat-job-runner/post-processing-stage'
import { createSupabaseMock } from '@/tests/mocks/supabase'
import { GET } from '@/app/api/chats/[chatId]/stats/route'
import { parseLatestUsageStatsResponse } from '@/app/dashboard/chats/[id]/hooks/useChatUsageStats'
import { buildChatUsageEvent } from '@/app/api/internal/chat-job-runner/usage-debug'
import { readUsageReceipt } from '@/lib/chat/usage-receipt'
import { readOpenRouterUsageStep } from './openrouter-usage'

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

const modelName = 'moonshotai/kimi-k3'
const first = {
  prompt_tokens: 9000,
  completion_tokens: 300,
  total_tokens: 9300,
  prompt_tokens_details: { cached_tokens: 6000, cache_write_tokens: 0 },
  completion_tokens_details: { reasoning_tokens: 100 },
}
const last = {
  prompt_tokens: 10000,
  completion_tokens: 1500,
  total_tokens: 11500,
  prompt_tokens_details: { cached_tokens: 8000, cache_write_tokens: 0 },
  completion_tokens_details: { reasoning_tokens: 500 },
}
function sse(usage?: Record<string, unknown>, isTool = false, responseModel = modelName) {
  const delta = isTool
    ? {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'call_1',
            type: 'function',
            function: { name: 'fetch_source_range', arguments: '{}' },
          },
        ],
      }
    : { role: 'assistant', content: 'Earlier conversation checked.' }
  const chunks = [
    {
      id: 'gen-fixture',
      created: 1792100000,
      model: responseModel,
      choices: [{ index: 0, delta, finish_reason: null }],
    },
    {
      id: 'gen-fixture',
      choices: [{ index: 0, delta: {}, finish_reason: isTool ? 'tool_calls' : 'stop' }],
      ...(usage ? { usage } : {}),
    },
  ]
  return new Response(
    chunks.map((chunk) => 'data: ' + JSON.stringify(chunk) + '\n\n').join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  )
}
async function collect(responses: Response[], requestedModel = modelName) {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  const stream = streamText({
    model: buildLanguageModel({
      provider: 'openrouter',
      modelName: requestedModel,
      apiKey: 'fake-test-key',
    }),
    prompt: 'Read earlier messages.',
    maxRetries: 0,
    ...(responses.length > 1
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
  const collected = await consumeStreamingResponseStage({
    supabase: {} as never,
    chatId: 'chat',
    jobId: 'job',
    stream: stream as never,
    provider: 'openrouter',
    regenerateAssistantMessageId: null,
    providerAbortSignal: new AbortController().signal,
    providerStreamTimeoutMs: 30000,
  })
  expect(fetchMock).toHaveBeenCalledTimes(responses.length)
  return { collected, stream }
}
async function persistAndRead(responses: Response[], requestedModel = modelName) {
  const { collected, stream } = await collect(responses, requestedModel)
  await runPostProcessingStage({
    supabase: {} as never,
    payload: {
      chatId: 'chat',
      userId: 'owner',
      apiKeyId: 'key',
      provider: 'openrouter',
      modelName: requestedModel,
      requestId: 'request',
    } as never,
    origin: 'https://internal.example.com',
    context: {
      apiKeyData: { service_tier: 'standard' },
      generationTranscript: [],
      finalSystemPrompt: 'System',
      dynamicContext: null,
      dynamicContextTokens: 0,
      recentMessages: [],
      ragInfo: null,
      bilingualEnabled: false,
      anthropicConversationMessages: null,
      anthropicPlaceholderAdded: false,
      totalInputTokens: 0,
      staticPromptTokens: 0,
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
  const persisted = mocks.pipeline.mock.calls.at(-1)![0]
  const receipt = readUsageReceipt(persisted.debugInfo)!
  expect(receipt).not.toBeNull()
  // Reproduce the small immutable record retained after prompt/debug pruning.
  mocks.latest.mockResolvedValue({
    id: 'answer',
    created_at: '2026-10-16T00:00:00Z',
    prompt_tokens: collected.usage.promptTokens,
    completion_tokens: collected.usage.completionTokens,
    debug_info: { usageOnly: true, usageReceipt: receipt },
  })
  const result = await GET(new Request('https://app.example/api/chats/chat/stats'), {
    params: Promise.resolve({ chatId: 'chat' }),
  })
  const stats = parseLatestUsageStatsResponse(await result.json())!
  const event = buildChatUsageEvent({
    userId: 'owner',
    chatId: 'chat',
    apiKeyId: 'key',
    provider: 'openrouter',
    modelName: requestedModel,
    usage: persisted.usage,
    usageCost: persisted.usageCost,
    requestId: 'request',
  })
  return { collected, stream, receipt, stats, event }
}

it('uses native billed cost rather than the catalog estimate or upstream inference cost', async () => {
  const { stats, receipt, event, stream } = await persistAndRead([
    sse({ ...last, cost: 0.025, cost_details: { upstream_inference_cost: 99 } }),
  ])
  expect(stats).toMatchObject({
    costUsd: 0.025,
    costSource: 'provider',
    prompt: 10000,
    completion: 1000,
    reasoning: 500,
    uncachedPrompt: 2000,
    cachedPrompt: 8000,
    cacheWrite: 0,
    promptCostUsd: null,
    completionCostUsd: null,
    reasoningCostUsd: null,
  })
  expect(receipt.cost?.total).toBe(0.025)
  expect(event.total_cost_usd).toBe(0.025)
  expect(await stream.providerMetadata).toMatchObject({ openrouter: { reportedCostUsd: 0.025 } })
})

it('sums every ATR call exactly once, including cache writes, into the persisted answer and event', async () => {
  const { stats, event, receipt } = await persistAndRead([
    sse(
      {
        ...first,
        cost: 0.002,
        prompt_tokens_details: { cached_tokens: 6000, cache_write_tokens: 1000 },
      },
      true,
    ),
    sse({
      ...last,
      cost: 0.03,
      prompt_tokens_details: { cached_tokens: 8000, cache_write_tokens: 1000 },
    }),
  ])
  expect(stats).toMatchObject({
    costUsd: 0.032,
    costSource: 'provider',
    callCount: 2,
    prompt: 19000,
    completion: 1200,
    reasoning: 600,
    cachedPrompt: 14000,
    cacheWrite: 2000,
    uncachedPrompt: 3000,
    total: 20800,
  })
  expect(event.total_cost_usd).toBe(0.032)
  expect(receipt.cost?.total).toBe(0.032)
})

it('retains an authoritative zero cost', async () => {
  const { stats, event } = await persistAndRead([sse({ ...last, cost: 0 })])
  expect(stats).toMatchObject({ costUsd: 0, costSource: 'provider' })
  expect(event.total_cost_usd).toBe(0)
})

it('supports billed cost for uncatalogued models and retains the returned model', async () => {
  const { stats } = await persistAndRead(
    [sse({ ...last, cost: 0.007 }, false, 'vendor/actual')],
    'router/custom',
  )
  expect(stats).toMatchObject({
    costUsd: 0.007,
    costSource: 'provider',
    billingModels: ['vendor/actual'],
  })
})

it('keeps reported total even when token usage is absent', async () => {
  const { stats, event } = await persistAndRead([sse({ cost: 0.008 })])
  expect(stats).toMatchObject({
    costUsd: 0.008,
    costSource: 'provider',
    prompt: null,
    completion: null,
    cachedPrompt: null,
    reasoning: null,
  })
  expect(event.total_cost_usd).toBe(0.008)
})

it('does not invent cache hits or reasoning when those counters are absent', async () => {
  const { completion_tokens_details, prompt_tokens_details, ...withoutCounters } = last
  void completion_tokens_details
  void prompt_tokens_details
  const { stats } = await persistAndRead([sse({ ...withoutCounters, cost: 0.008 })])
  expect(stats).toMatchObject({
    costUsd: 0.008,
    costSource: 'provider',
    cachedPrompt: null,
    completion: null,
    reasoning: null,
  })
})

it.each([undefined, null, -1, '0.025'])(
  'falls back to an explicitly estimated cost without double-counting reasoning: %s',
  async (cost) => {
    const { stats, event } = await persistAndRead([sse({ ...last, cost })])
    expect(stats).toMatchObject({ costSource: 'estimated', completion: 1000, reasoning: 500 })
    expect(stats.costUsd).toBeCloseTo(0.0309, 12)
    expect(stats.completionCostUsd).toBeCloseTo(0.015, 12)
    expect(stats.reasoningCostUsd).toBeCloseTo(0.0075, 12)
    expect(event.total_cost_usd).toBeCloseTo(0.0309, 12)
  },
)

it('estimates all ATR calls if one billed cost is missing, never showing the partial provider sum', async () => {
  const { stats } = await persistAndRead([sse({ ...first, cost: 0.002 }, true), sse(last)])
  expect(stats).toMatchObject({
    costSource: 'estimated',
    callCount: 2,
    completion: 1200,
    reasoning: 600,
  })
  expect(stats.costUsd).toBeCloseTo(0.0462, 12)
})

it('keeps an incomplete ATR bill unknown when a complete estimate is unavailable', async () => {
  const { stats } = await persistAndRead(
    [sse({ ...first, cost: 0.002 }, true, 'vendor/unknown'), sse(last, false, 'vendor/unknown')],
    'vendor/unknown',
  )
  expect(stats).toMatchObject({ costUsd: null, costSource: null, callCount: 2 })
})

it('keeps cost unknown when neither bill nor token usage was returned', async () => {
  const { stats } = await persistAndRead([sse()])
  expect(stats).toMatchObject({ costUsd: null, costSource: null, prompt: null, completion: null })
})

it('does not estimate missing cache usage as fully uncached input', async () => {
  const { stats } = await persistAndRead([sse({ ...last, prompt_tokens_details: undefined })])
  expect(stats.costUsd).toBeNull()
})

it('does not guess a write price when native writes are reported but the catalog has no write rate', async () => {
  const { stats } = await persistAndRead([
    sse({ ...last, prompt_tokens_details: { cached_tokens: 8000, cache_write_tokens: 1000 } }),
  ])
  expect(stats.costUsd).toBeNull()
  expect(stats.cacheWrite).toBe(1000)
})

it('retains billing metadata in non-streaming generateText too', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'gen-json',
          created: 1792100000,
          model: modelName,
          choices: [
            { index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' },
          ],
          usage: { ...last, cost: 0.025 },
        }),
        { headers: { 'content-type': 'application/json' } },
      ),
    ),
  )
  const result = await generateText({
    model: buildLanguageModel({ provider: 'openrouter', modelName, apiKey: 'fake-test-key' }),
    prompt: 'Hello',
    maxRetries: 0,
  })
  expect(readOpenRouterUsageStep(result)).toMatchObject({
    reportedCostUsd: 0.025,
    modelName,
    completionTokens: 1500,
    reasoningTokens: 500,
  })
})
