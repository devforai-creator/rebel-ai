import { describe, expect, it } from 'vitest'

import { buildVisibleMessages, findLastAssistantIndex } from './message-list-state'

describe('buildVisibleMessages', () => {
  it('replaces the target message when the streaming draft points at an existing assistant reply', () => {
    expect(
      buildVisibleMessages(
        [
          { id: 'message-1', role: 'user', content: 'Hello' },
          { id: 'message-2', role: 'assistant', content: 'Old reply' },
        ],
        {
          id: 'stream-1',
          jobId: 'job-1',
          role: 'assistant',
          content: 'Streaming replacement',
          streaming: true,
          replaceMessageId: 'message-2',
        },
      ),
    ).toEqual([
      { id: 'message-1', role: 'user', content: 'Hello' },
      {
        id: 'stream-1',
        jobId: 'job-1',
        role: 'assistant',
        content: 'Streaming replacement',
        streaming: true,
        replaceMessageId: 'message-2',
      },
    ])
  })

  it('appends the streaming draft when there is no replacement target', () => {
    expect(
      buildVisibleMessages([{ id: 'message-1', role: 'user', content: 'Hello' }], {
        id: 'stream-1',
        jobId: 'job-1',
        role: 'assistant',
        content: 'New reply',
        streaming: true,
        replaceMessageId: null,
      }),
    ).toEqual([
      { id: 'message-1', role: 'user', content: 'Hello' },
      {
        id: 'stream-1',
        jobId: 'job-1',
        role: 'assistant',
        content: 'New reply',
        streaming: true,
        replaceMessageId: null,
      },
    ])
  })
})

describe('findLastAssistantIndex', () => {
  it('returns the last assistant index when one exists', () => {
    expect(
      findLastAssistantIndex([
        { id: 'message-1', role: 'assistant', content: 'Old reply' },
        { id: 'message-2', role: 'user', content: 'Question' },
        { id: 'message-3', role: 'assistant', content: 'Latest reply' },
      ]),
    ).toBe(2)
  })

  it('returns -1 when the list has no assistant message', () => {
    expect(findLastAssistantIndex([{ id: 'message-1', role: 'user', content: 'Hello' }])).toBe(-1)
  })
})
