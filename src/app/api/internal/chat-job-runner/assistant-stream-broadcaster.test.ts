import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  broadcastAssistantStreamError,
  broadcastAssistantStreamSnapshot,
} from './assistant-stream-broadcaster'
import {
  CHAT_ASSISTANT_STREAM_EVENT,
  getChatAssistantStreamChannelName,
} from '@/lib/chat/assistant-stream'

describe('assistant stream broadcaster', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns early when the admin client does not expose channels', async () => {
    await expect(
      broadcastAssistantStreamSnapshot({
        supabase: {} as never,
        chatId: 'chat-1',
        jobId: 'job-1',
        content: 'hello',
        regenerateAssistantMessageId: null,
      }),
    ).resolves.toBeUndefined()

    expect(console.warn).not.toHaveBeenCalled()
  })

  it('broadcasts snapshot payloads without logging when send succeeds', async () => {
    const send = vi.fn(async () => 'ok')
    const channel = vi.fn(() => ({ send }))

    await broadcastAssistantStreamSnapshot({
      supabase: { channel } as never,
      chatId: 'chat-1',
      jobId: 'job-1',
      content: 'hello',
      regenerateAssistantMessageId: 'assistant-1',
    })

    expect(channel).toHaveBeenCalledWith(getChatAssistantStreamChannelName('chat-1'))
    expect(send).toHaveBeenCalledWith({
      type: 'broadcast',
      event: CHAT_ASSISTANT_STREAM_EVENT,
      payload: {
        kind: 'snapshot',
        jobId: 'job-1',
        content: 'hello',
        regenerateAssistantMessageId: 'assistant-1',
      },
    })
    expect(console.warn).not.toHaveBeenCalled()
  })

  it('warns when the realtime broadcast returns a non-ok status', async () => {
    const send = vi.fn(async () => 'timed out')
    const channel = vi.fn(() => ({ send }))

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
        kind: 'snapshot',
        status: 'timed out',
      },
    )
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
        kind: 'error',
        error: 'socket down',
      },
    )
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
        kind: 'error',
        error: 'socket exploded',
      },
    )
  })
})
