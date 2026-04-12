import type { Message } from '@/types/database.types'
import { describe, expect, it } from 'vitest'

import { combineHistoryWithLiveMessages } from './useChatHistory'

describe('combineHistoryWithLiveMessages', () => {
  it('returns the live messages unchanged when there is no history', () => {
    const liveMessages = [
      { id: 'live-1', role: 'user' as const, content: 'hello' },
      { id: 'live-2', role: 'assistant' as const, content: 'world' },
    ]

    expect(combineHistoryWithLiveMessages([], liveMessages)).toEqual(liveMessages)
  })

  it('prepends mapped history messages ahead of live messages', () => {
    expect(
      combineHistoryWithLiveMessages(
        [
          {
            id: 'history-1',
            role: 'user',
            content: 'Older user message',
            created_at: '2026-04-12T00:00:00.000Z',
          } as Message,
        ],
        [{ id: 'live-1', role: 'assistant', content: 'Newest assistant message' }],
      ),
    ).toEqual([
      {
        id: 'history-1',
        role: 'user',
        content: 'Older user message',
        created_at: '2026-04-12T00:00:00.000Z',
      },
      {
        id: 'live-1',
        role: 'assistant',
        content: 'Newest assistant message',
      },
    ])
  })
})
