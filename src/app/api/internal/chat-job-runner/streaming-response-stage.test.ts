import { beforeEach, describe, expect, it, vi } from 'vitest'

const broadcastAssistantStreamSnapshotMock = vi.fn()
const broadcastAssistantStreamErrorMock = vi.fn()
const evaluateContentFilterMock = vi.fn()
const normalizeProviderErrorMock = vi.fn()

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
}))

async function* textDeltaStream(parts: string[]) {
  for (const part of parts) {
    yield part
  }
}

async function* fullDeltaStream(parts: Array<{ type: string; text?: string; error?: unknown }>) {
  for (const part of parts) {
    yield part
  }
}

describe('consumeStreamingResponseStage', () => {
  beforeEach(() => {
    broadcastAssistantStreamSnapshotMock.mockReset()
    broadcastAssistantStreamErrorMock.mockReset()
    evaluateContentFilterMock.mockReset()
    normalizeProviderErrorMock.mockReset()

    broadcastAssistantStreamSnapshotMock.mockResolvedValue(undefined)
    broadcastAssistantStreamErrorMock.mockResolvedValue(undefined)
    evaluateContentFilterMock.mockReturnValue({ blocked: false, categories: [] })
    normalizeProviderErrorMock.mockReturnValue({ userMessage: 'Friendly stream error' })
  })

  it('streams snapshots and returns usage metadata for a successful response', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    const result = await consumeStreamingResponseStage({
      supabase: {} as never,
      chatId: 'chat-1',
      jobId: 'job-1',
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

  it('normalizes stream failures and broadcasts an error payload', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    await expect(
      consumeStreamingResponseStage({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-err',
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

  it('treats blocked empty responses as content-filter failures', async () => {
    const { consumeStreamingResponseStage } = await import('./streaming-response-stage')

    evaluateContentFilterMock.mockReturnValueOnce({ blocked: true, categories: ['SAFETY'] })

    await expect(
      consumeStreamingResponseStage({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-filtered',
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
