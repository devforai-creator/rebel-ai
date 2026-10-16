import { runPostProcessingStage } from '@/app/api/internal/chat-job-runner/post-processing-stage'
import { afterEach, expect, it, vi } from 'vitest'
import { jsonSchema, stepCountIs, streamText, tool } from 'ai'
import { buildLanguageModel } from './model-factory'
import { priceUsageSteps } from './usage'
import { buildUsageReceipt, readUsageReceipt } from '@/lib/chat/usage-receipt'
import { consumeStreamingResponseStage } from '@/app/api/internal/chat-job-runner/streaming-response-stage'

const { pipeline } = vi.hoisted(() => ({
  pipeline: vi.fn().mockResolvedValue({
    messageInsertDuration: null,
    usageEventInsertDurationMs: 0,
    summaryTriggerDurationMs: null,
  }),
}))
vi.mock('@/app/api/internal/chat-job-runner/post-generation-pipeline', () => ({
  runPostGenerationPipeline: pipeline,
}))

vi.mock('@/app/api/internal/chat-job-runner/assistant-stream-broadcaster', () => ({
  broadcastAssistantStreamSnapshot: vi.fn().mockResolvedValue(undefined),
  broadcastAssistantStreamError: vi.fn().mockResolvedValue(undefined),
}))
afterEach(() => vi.unstubAllGlobals())

function sse(index: number, usage: Record<string, unknown>, output: number, isTool: boolean) {
  const content = isTool
    ? { type: 'tool_use', id: 'call-1', name: 'fetch_source_range', input: {} }
    : { type: 'text', text: '' }
  const events = [
    {
      type: 'message_start',
      message: {
        id: `msg-${index}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [],
        usage: { ...usage, output_tokens: 0 },
      },
    },
    { type: 'content_block_start', index: 0, content_block: content },
    {
      type: 'content_block_delta',
      index: 0,
      delta: isTool
        ? { type: 'input_json_delta', partial_json: '{}' }
        : { type: 'text_delta', text: '이전 대화를 확인했습니다.' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: isTool ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: output },
    },
    { type: 'message_stop' },
  ]
  return new Response(
    events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}

it('collects every real SDK ATR step, including mixed TTL writes, into one answer receipt', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      sse(
        1,
        {
          input_tokens: 3000,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 1000,
          cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
        },
        150,
        true,
      ),
    )
    .mockResolvedValueOnce(
      sse(
        2,
        {
          input_tokens: 500,
          cache_read_input_tokens: 6500,
          cache_creation_input_tokens: 250,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 250 },
        },
        1000,
        false,
      ),
    )
  vi.stubGlobal('fetch', fetchMock)
  const execute = vi.fn(async () => ({ messages: ['이전 대화'] }))
  const stream = streamText({
    model: buildLanguageModel({
      provider: 'anthropic',
      modelName: 'claude-opus-4-7',
      apiKey: 'test-key',
    }),
    prompt: '이전 대화를 확인해주세요.',
    tools: {
      fetch_source_range: tool({
        description: 'Read prior messages',
        inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
        execute,
      }),
    },
    stopWhen: stepCountIs(2),
  })
  const collected = await consumeStreamingResponseStage({
    supabase: {} as never,
    chatId: 'chat',
    jobId: 'job',
    stream: stream as never,
    provider: 'anthropic',
    regenerateAssistantMessageId: null,
    providerAbortSignal: new AbortController().signal,
    providerStreamTimeoutMs: 240000,
  })
  expect(execute).toHaveBeenCalledTimes(1)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(collected.usage).toMatchObject({
    promptTokens: 3500,
    completionTokens: 1150,
    cachedInputTokens: 8500,
    cacheWriteTokens: 1250,
  })
  expect(collected.usageSteps).toHaveLength(2)
  const cost = priceUsageSteps({
    provider: 'anthropic',
    steps: collected.usageSteps!,
    modelName: 'claude-opus-4-7',
    cacheWriteTtl: '1h',
  })!
  expect(cost).toMatchObject({ cacheWrite5mTokens: 400, cacheWrite1hTokens: 850 })
  expect(cost.totalCost).toBeCloseTo(0.0615, 12)
  expect(cost.promptCost).toBeCloseTo(0.0285, 12)
  const receipt = buildUsageReceipt({
    requestId: 'request',
    provider: 'anthropic',
    modelName: 'claude-opus-4-7',
    callCount: 2,
    usage: collected.usage,
    cost,
  })
  expect(readUsageReceipt({ usageReceipt: receipt })).toEqual(receipt)
  expect(receipt).toMatchObject({
    input: 13250,
    uncachedInput: 3500,
    output: 1150,
    cachedInput: 8500,
    cacheWrite5m: 400,
    cacheWrite1h: 850,
    callCount: 2,
  })
  expect(
    Object.entries(receipt.cost!)
      .filter(([key]) => key !== 'total')
      .reduce((s, [, value]) => s + (value ?? 0), 0),
  ).toBeCloseTo(receipt.cost!.total!, 12)
})

it('prices calls separately when the sum crosses a prompt pricing threshold', () => {
  const step = {
    promptTokens: 80000,
    completionTokens: 1000,
    totalTokens: 81000,
    cachedInputTokens: 0,
    reasoningTokens: null,
    cacheWriteTokens: 0,
  }
  const cost = priceUsageSteps({
    provider: 'anthropic',
    steps: [step, step],
    modelName: 'claude-haiku-5-5',
  })!
  expect(cost.totalCost).toBeCloseTo(0.017, 12)
  const opus = priceUsageSteps({
    provider: 'anthropic',
    steps: [{ ...step, promptTokens: 300000 }],
    modelName: 'claude-opus-4-6',
  })!
  expect(opus.totalCost).toBeCloseTo(1.525, 12)
  expect(
    priceUsageSteps({
      provider: 'anthropic',
      steps: [{ ...step, promptTokens: null }],
      modelName: 'claude-opus-4-7',
    }),
  ).toBeNull()
})

it('retains mixed native TTL writes through real SDK ATR and persistence when model pricing is unknown', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(
        sse(
          1,
          {
            input_tokens: 3000,
            cache_read_input_tokens: 2000,
            cache_creation_input_tokens: 1000,
            cache_creation: { ephemeral_5m_input_tokens: 400, ephemeral_1h_input_tokens: 600 },
          },
          150,
          true,
        ),
      )
      .mockResolvedValueOnce(
        sse(
          2,
          { input_tokens: 500, cache_read_input_tokens: 6500, cache_creation_input_tokens: 250 },
          1000,
          false,
        ),
      ),
  )
  const stream = streamText({
    model: buildLanguageModel({
      provider: 'anthropic',
      modelName: 'claude-custom-unpriced',
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
  const collected = await consumeStreamingResponseStage({
    supabase: {} as never,
    chatId: 'chat',
    jobId: 'job',
    stream: stream as never,
    provider: 'anthropic',
    regenerateAssistantMessageId: null,
    providerAbortSignal: new AbortController().signal,
    providerStreamTimeoutMs: 30000,
  })
  await runPostProcessingStage({
    supabase: {} as never,
    payload: {
      chatId: 'chat',
      userId: 'owner',
      apiKeyId: 'key',
      provider: 'anthropic',
      modelName: 'claude-custom-unpriced',
      requestId: 'request',
    } as never,
    origin: 'http://local',
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
      anthropicCache: { enabled: true, ttl: '1h', minTokens: 1024 },
      googleExplicitCacheEnabled: false,
      googleCacheDecision: null,
      googleCacheResult: null,
      actualPayload: null,
    },
    streamingResponse: collected,
  })
  const receipt = readUsageReceipt(pipeline.mock.calls.at(-1)![0].debugInfo)
  expect(receipt).toMatchObject({
    input: 13250,
    cachedInput: 8500,
    cacheWrite5m: 400,
    cacheWrite1h: 850,
    callCount: 2,
    cost: null,
  })
})
