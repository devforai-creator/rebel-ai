import { describe, expect, it } from 'vitest'
import { buildSanitizedMessages, mapMessageToDisplay } from './types'

describe('chat display type helpers', () => {
  it('maps database messages into display messages', () => {
    expect(
      mapMessageToDisplay({
        id: 'msg-1',
        role: 'assistant',
        content: 'hello',
        chat_id: 'chat-1',
        sequence: 3,
        model_used: 'gpt-test',
        prompt_tokens: 11,
        completion_tokens: 22,
        created_at: '2026-01-01T00:00:00.000Z',
        debug_info: { cacheHit: true },
      } as never),
    ).toEqual({
      id: 'msg-1',
      role: 'assistant',
      content: 'hello',
      chat_id: 'chat-1',
      sequence: 3,
      model_used: 'gpt-test',
      prompt_tokens: 11,
      completion_tokens: 22,
      created_at: '2026-01-01T00:00:00.000Z',
      debug_info: { cacheHit: true },
    })
  })

  it('builds sanitized message arrays from history and current messages', () => {
    const history = [
      {
        id: 'hist-user',
        role: 'user',
        content: 'history user',
        chat_id: 'chat-1',
      },
      {
        id: 'hist-system',
        role: 'system',
        content: 'system note',
        chat_id: 'chat-1',
      },
    ]

    const current = [
      {
        id: 'live-assistant',
        role: 'assistant',
        content: 'live reply',
      },
      {
        id: 'temp-user',
        role: 'user',
        content: 'draft user',
        temp: true,
      },
      {
        id: 'streaming-assistant',
        role: 'assistant',
        content: 'partial',
        streaming: true,
      },
    ]

    expect(buildSanitizedMessages(history as never, current as never)).toEqual([
      {
        role: 'user',
        content: 'history user',
        messageId: 'hist-user',
      },
      {
        role: 'assistant',
        content: 'live reply',
        messageId: 'live-assistant',
      },
      {
        role: 'user',
        content: 'draft user',
        messageId: null,
      },
    ])
  })
})
