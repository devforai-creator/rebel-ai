import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  broadcastAssistantStreamError,
  broadcastAssistantStreamSnapshot,
} from './assistant-stream-broadcaster'
import {
  CHAT_ASSISTANT_STREAM_EVENT,
  getChatAssistantStreamChannelName,
} from '@/lib/chat/assistant-stream'
import {
  __resetAssistantStreamBroadcastStatsForTest,
  getAssistantStreamBroadcastStats,
} from '@/lib/chat/assistant-stream-monitor'

describe('assistant stream broadcaster', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    __resetAssistantStreamBroadcastStatsForTest()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records a failure when the admin client does not expose channels', async () => {
    await expect(
      broadcastAssistantStreamSnapshot({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-1',
        content: 'hello',
        regenerateAssistantMessageId: null,
      }),
    ).resolves.toBeUndefined()

    expect(console.warn).toHaveBeenCalledWith(
      '[Chat Job Runner] Assistant stream broadcast unavailable',
      {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'snapshot',
        stage: 'missing-channel-api',
      },
    )
    expect(getAssistantStreamBroadcastStats()).toMatchObject({
      totalSuccesses: 0,
      totalFailures: 1,
      consecutiveFailures: 1,
      lastErrorMessage: 'Supabase admin client does not expose channel()',
      lastMetadata: {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'snapshot',
        stage: 'missing-channel-api',
      },
    })
  })

  it('broadcasts snapshot payloads over httpSend without logging when available', async () => {
    const httpSend = vi.fn(async () => ({ success: true as const }))
    const channel = vi.fn(() => ({ httpSend }))

    await broadcastAssistantStreamSnapshot({
      supabase: { channel } as never,
      chatId: 'chat-1',
      jobId: 'job-1',
      content: 'hello',
      regenerateAssistantMessageId: 'assistant-1',
    })

    expect(channel).toHaveBeenCalledWith(getChatAssistantStreamChannelName('chat-1'))
    expect(httpSend).toHaveBeenCalledWith(CHAT_ASSISTANT_STREAM_EVENT, {
      kind: 'snapshot',
      jobId: 'job-1',
      content: 'hello',
      regenerateAssistantMessageId: 'assistant-1',
    })
    expect(console.warn).not.toHaveBeenCalled()
    expect(getAssistantStreamBroadcastStats()).toMatchObject({
      totalSuccesses: 1,
      totalFailures: 0,
      consecutiveFailures: 0,
      lastMetadata: {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'snapshot',
        stage: 'http-send',
        status: 'ok',
      },
    })
  })

  it('falls back to send when httpSend is unavailable', async () => {
    const send = vi.fn(async () => 'timed out')
    const channel = vi.fn(() => ({ send }))

    await broadcastAssistantStreamSnapshot({
      supabase: { channel } as never,
      chatId: 'chat-1',
      jobId: 'job-1',
      content: 'hello',
      regenerateAssistantMessageId: null,
    })

    expect(send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: CHAT_ASSISTANT_STREAM_EVENT,
      payload: {
        kind: 'snapshot',
        jobId: 'job-1',
        content: 'hello',
        regenerateAssistantMessageId: null,
      },
    })
  })

  it('warns when the explicit HTTP broadcast returns a non-success result', async () => {
    const httpSend = vi.fn(async () => ({
      success: false as const,
      status: 503,
      error: 'broadcast unavailable',
    }))
    const channel = vi.fn(() => ({ httpSend }))

    await broadcastAssistantStreamSnapshot({
      supabase: { channel } as never,
      chatId: 'chat-1',
      jobId: 'job-1',
      content: 'hello',
      regenerateAssistantMessageId: null,
    })

    expect(console.warn).toHaveBeenCalledWith(
      '[Chat Job Runner] Assistant stream broadcast failed',
      {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'snapshot',
        stage: 'http-send',
        status: 503,
        error: 'broadcast unavailable',
      },
    )
    expect(getAssistantStreamBroadcastStats()).toMatchObject({
      totalSuccesses: 0,
      totalFailures: 1,
      consecutiveFailures: 1,
      lastErrorMessage: 'Assistant stream broadcast returned status 503: broadcast unavailable',
      lastMetadata: {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'snapshot',
        stage: 'http-send',
        status: 503,
      },
    })
  })

  it('logs thrown Error instances with their message', async () => {
    const send = vi.fn(async () => {
      throw new Error('socket down')
    })
    const channel = vi.fn(() => ({ send }))

    await broadcastAssistantStreamError({
      supabase: { channel } as never,
      chatId: 'chat-1',
      jobId: 'job-1',
      error: 'runner failed',
      regenerateAssistantMessageId: null,
    })

    expect(console.warn).toHaveBeenCalledWith(
      '[Chat Job Runner] Assistant stream broadcast errored',
      {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'error',
        error: 'socket down',
      },
    )
    expect(getAssistantStreamBroadcastStats()).toMatchObject({
      totalSuccesses: 0,
      totalFailures: 1,
      consecutiveFailures: 1,
      lastErrorMessage: 'socket down',
      lastMetadata: {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'error',
        stage: 'send',
      },
    })
  })

  it('stringifies non-Error throws when broadcasting fails', async () => {
    const send = vi.fn(async () => {
      throw 'socket exploded'
    })
    const channel = vi.fn(() => ({ send }))

    await broadcastAssistantStreamError({
      supabase: { channel } as never,
      chatId: 'chat-1',
      jobId: 'job-1',
      error: 'runner failed',
      regenerateAssistantMessageId: 'assistant-1',
    })

    expect(console.warn).toHaveBeenCalledWith(
      '[Chat Job Runner] Assistant stream broadcast errored',
      {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'error',
        error: 'socket exploded',
      },
    )
    expect(getAssistantStreamBroadcastStats()).toMatchObject({
      totalSuccesses: 0,
      totalFailures: 1,
      consecutiveFailures: 1,
      lastErrorMessage: 'socket exploded',
      lastMetadata: {
        chatId: 'chat-1',
        jobId: 'job-1',
        kind: 'error',
        stage: 'send',
      },
    })
  })
})
