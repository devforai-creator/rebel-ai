import { beforeEach, describe, expect, it, vi } from 'vitest'

const broadcastAssistantStreamSnapshotMock = vi.fn()
const broadcastAssistantStreamErrorMock = vi.fn()
const evaluateContentFilterMock = vi.fn()
const normalizeProviderErrorMock = vi.fn()
const isGoogleExplicitCacheToolConflictMock = vi.fn()

vi.mock('./assistant-stream-broadcaster', () => ({
  broadcastAssistantStreamSnapshot: (...args: unknown[]) =>
    broadcastAssistantStreamSnapshotMock(...args),
  broadcastAssistantStreamError: (...args: unknown[]) => broadcastAssistantStreamErrorMock(...args),
}))

vi.mock('./content-filter', () => ({
  evaluateContentFilter: (...args: unknown[]) => evaluateContentFilterMock(...args),
}))

vi.mock('@/lib/llm/provider-error', () => ({
  normalizeProviderError: (...args: unknown[]) => normalizeProviderErrorMock(...args),
  isGoogleExplicitCacheToolConflict: (...args: unknown[]) =>
    isGoogleExplicitCacheToolConflictMock(...args),
}))

async function* textDeltaStream(parts: string[]) {
  for (const part of parts) {
    yield part
  }
}

async function* fullDeltaStream(
  parts: Array<{
    type: string
    text?: string
    error?: unknown
    providerMetadata?: Record<string, unknown>
  }>,
) {
  for (const part of parts) {
    yield part
  }
}

function createProviderTimeoutContext({
  timedOut = false,
  timeoutMs = 240_000,
}: {
  timedOut?: boolean
  timeoutMs?: number
} = {}) {
  const controller = new AbortController()
  if (timedOut) {
    controller.abort(new DOMException('Timed out', 'TimeoutError'))
  }

  return {
    providerAbortSignal: controller.signal,
    providerStreamTimeoutMs: timeoutMs,
  }
}

describe('consumeStreamingResponseStage', () => {
  beforeEach(() => {
    broadcastAssistantStreamSnapshotMock.mockReset()
    broadcastAssistantStreamErrorMock.mockReset()
    evaluateContentFilterMock.mockReset()
    normalizeProviderErrorMock.mockReset()
    isGoogleExplicitCacheToolConflictMock.mockReset()

    broadcastAssistantStreamSnapshotMock.mockResolvedValue(undefined)
    broadcastAssistantStreamErrorMock.mockResolvedValue(undefined)
    evaluateContentFilterMock.mockReturnValue({ blocked: false, categories: [] })
    normalizeProviderErrorMock.mockReturnValue({ userMessage: 'Friendly stream error' })
    isGoogleExplicitCacheToolConflictMock.mockReturnValue(false)
  })

  it('streams snapshots and returns usage metadata for a successful response', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    const result = await consumeStreamingResponseStage({
      supabase: {} as never,
      chatId: 'chat-1',
      jobId: 'job-1',
      ...createProviderTimeoutContext(),
      stream: {
        textStream: textDeltaStream(['hello', ' world']),
        finishReason: Promise.resolve('stop'),
        providerMetadata: Promise.resolve({}),
        usage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 4,
          reasoningTokens: 2,
        }),
      } as never,
      provider: 'openai',
      regenerateAssistantMessageId: 'assistant-1',
      updateIntervalMs: 0,
      now: (() => {
        let tick = 0
        return () => {
          tick += 1
          return tick
        }
      })(),
    })

    expect(broadcastAssistantStreamSnapshotMock).toHaveBeenCalled()
    expect(broadcastAssistantStreamErrorMock).not.toHaveBeenCalled()
    expect(result).toEqual({
      fullText: 'hello world',
      assistantText: 'hello world',
      finishReason: 'stop',
      anthropicCacheCreationInputTokens: null,
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        cachedInputTokens: 4,
        reasoningTokens: 2,
      },
    })
  })

  it('records anthropic thinking usage metrics when reasoning tokens are reported', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')
    const debugMetrics: Record<string, string | number | boolean | null> = {}

    await consumeStreamingResponseStage({
      supabase: {} as never,
      chatId: 'chat-1',
      jobId: 'job-anthropic-thinking',
      ...createProviderTimeoutContext(),
      stream: {
        textStream: textDeltaStream(['ok']),
        finishReason: Promise.resolve('stop'),
        providerMetadata: Promise.resolve({ anthropic: { usage: { input_tokens: 1 } } }),
        usage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 0,
          reasoningTokens: 7,
        }),
      } as never,
      provider: 'anthropic',
      regenerateAssistantMessageId: null,
      debugMetrics,
    })

    expect(debugMetrics).toMatchObject({
      anthropic_reasoning_tokens_reported: 7,
      anthropic_thinking_used: true,
    })
  })

  it('detects anthropic thinking usage from streamed reasoning blocks when reasoning tokens are absent', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')
    const debugMetrics: Record<string, string | number | boolean | null> = {}

    await consumeStreamingResponseStage({
      supabase: {} as never,
      chatId: 'chat-1',
      jobId: 'job-anthropic-streamed-thinking',
      ...createProviderTimeoutContext(),
      stream: {
        textStream: textDeltaStream([]),
        fullStream: fullDeltaStream([
          { type: 'reasoning-start' },
          {
            type: 'reasoning-delta',
            providerMetadata: {
              anthropic: { signature: 'sig_123' },
            },
          },
          { type: 'text-delta', text: 'ok' },
        ]),
        finishReason: Promise.resolve('stop'),
        providerMetadata: Promise.resolve({ anthropic: { usage: { input_tokens: 1 } } }),
        usage: Promise.resolve({
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
          cachedInputTokens: 0,
          reasoningTokens: null,
        }),
      } as never,
      provider: 'anthropic',
      regenerateAssistantMessageId: null,
      debugMetrics,
    })

    expect(debugMetrics).toMatchObject({
      anthropic_thinking_block_seen: true,
      anthropic_reasoning_delta_count: 1,
      anthropic_signature_delta_seen: true,
      anthropic_reasoning_tokens_reported: null,
      anthropic_thinking_used: true,
    })
  })

  it('normalizes stream failures and broadcasts an error payload', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    await expect(
      consumeStreamingResponseStage({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-err',
        ...createProviderTimeoutContext(),
        stream: {
          textStream: textDeltaStream([]),
          fullStream: fullDeltaStream([{ type: 'error', error: new Error('socket down') }]),
          finishReason: Promise.resolve('error'),
          providerMetadata: Promise.resolve({}),
          usage: Promise.resolve(null),
        } as never,
        provider: 'openai',
        regenerateAssistantMessageId: null,
      }),
    ).rejects.toMatchObject({
      message: 'Friendly stream error',
      lifecycleStage: 'provider_stream_error',
    })

    expect(normalizeProviderErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
      }),
    )
    expect(broadcastAssistantStreamErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'chat-1',
        jobId: 'job-err',
        error: 'Friendly stream error',
      }),
    )
  })

  it('classifies a hard timeout even when the SDK surfaces NoOutputGeneratedError', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')
    await expect(
      consumeStreamingResponseStage({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-hard-timeout',
        ...createProviderTimeoutContext({ timedOut: true, timeoutMs: 12 * 60 * 1000 }),
        stream: {
          textStream: textDeltaStream([]),
          finishReason: Promise.reject(new Error('No output generated.')),
          providerMetadata: Promise.resolve({}),
          usage: Promise.resolve(null),
        } as never,
        provider: 'openrouter',
        regenerateAssistantMessageId: null,
      }),
    ).rejects.toMatchObject({
      message: 'The model provider did not finish within 12 minutes. Please try again.',
      lifecycleStage: 'timed_out',
      details: {
        streamedTextLength: 0,
        providerStreamTimeoutMs: 12 * 60 * 1000,
      },
    })

    expect(broadcastAssistantStreamErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-hard-timeout',
        error: 'The model provider did not finish within 12 minutes. Please try again.',
      }),
    )
  })

  it('classifies finish metadata failures as provider stream failures', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    await expect(
      consumeStreamingResponseStage({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-finish-error',
        ...createProviderTimeoutContext(),
        stream: {
          textStream: textDeltaStream([]),
          finishReason: Promise.reject(new Error('No output generated.')),
          providerMetadata: Promise.resolve({}),
          usage: Promise.resolve(null),
        } as never,
        provider: 'openrouter',
        regenerateAssistantMessageId: null,
      }),
    ).rejects.toMatchObject({
      message: 'Friendly stream error',
      lifecycleStage: 'provider_stream_error',
    })

    expect(broadcastAssistantStreamErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'job-finish-error',
        error: 'Friendly stream error',
      }),
    )
  })

  it('suppresses the first Google stream error broadcast for explicit-cache tool conflicts', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    normalizeProviderErrorMock.mockReturnValueOnce({
      category: 'unknown',
      userMessage: 'Friendly stream error',
      technicalMessage: 'cached content is not compatible with function calling',
      providerCode: 'INVALID_ARGUMENT',
      retryable: false,
      recognized: false,
    })
    isGoogleExplicitCacheToolConflictMock.mockReturnValueOnce(true)

    await expect(
      consumeStreamingResponseStage({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-google-cache-tool-conflict',
        ...createProviderTimeoutContext(),
        stream: {
          textStream: textDeltaStream([]),
          fullStream: fullDeltaStream([
            {
              type: 'error',
              error: {
                message: 'cached content is not compatible with function calling',
                code: 'INVALID_ARGUMENT',
              },
            },
          ]),
          finishReason: Promise.resolve('error'),
          providerMetadata: Promise.resolve({}),
          usage: Promise.resolve(null),
        } as never,
        provider: 'google',
        regenerateAssistantMessageId: null,
        allowGoogleExplicitCacheRecovery: true,
      }),
    ).rejects.toMatchObject({
      message: 'Friendly stream error',
      lifecycleStage: 'provider_stream_error',
      details: expect.objectContaining({
        streamedTextLength: 0,
        googleExplicitCacheToolConflict: true,
      }),
    })

    expect(broadcastAssistantStreamErrorMock).not.toHaveBeenCalled()
  })

  it('treats blocked empty responses as content-filter failures', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    evaluateContentFilterMock.mockReturnValueOnce({ blocked: true, categories: ['SAFETY'] })

    await expect(
      consumeStreamingResponseStage({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-filtered',
        ...createProviderTimeoutContext(),
        stream: {
          textStream: textDeltaStream([]),
          finishReason: Promise.resolve('content-filter'),
          providerMetadata: Promise.resolve({ google: { finishReason: 'SAFETY' } }),
          usage: Promise.resolve(null),
        } as never,
        provider: 'google',
        regenerateAssistantMessageId: null,
      }),
    ).rejects.toMatchObject({
      message:
        'Blocked by Google Gemini content filter. Please disable safe mode or refine your input and try again.',
      lifecycleStage: 'content_filtered',
    })

    expect(broadcastAssistantStreamErrorMock).not.toHaveBeenCalled()
  })

  it('treats non-blocked empty responses as empty-response failures', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    await expect(
      consumeStreamingResponseStage({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-empty',
        ...createProviderTimeoutContext(),
        stream: {
          textStream: textDeltaStream([]),
          finishReason: Promise.resolve('stop'),
          providerMetadata: Promise.resolve({}),
          usage: Promise.resolve(null),
        } as never,
        provider: 'openai',
        regenerateAssistantMessageId: null,
      }),
    ).rejects.toMatchObject({
      message: 'The assistant returned an empty response. Please try again later.',
      lifecycleStage: 'empty_response',
    })

    expect(broadcastAssistantStreamErrorMock).not.toHaveBeenCalled()
  })
})
