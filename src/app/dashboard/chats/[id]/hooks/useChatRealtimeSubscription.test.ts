import { describe, expect, it } from 'vitest'

import {
  parseAssistantStreamBroadcastPayload,
  parseMessageChangePayload,
} from './useChatRealtimeSubscription'

describe('parseMessageChangePayload', () => {
  it('parses valid message change payloads', () => {
    expect(
      parseMessageChangePayload({
        eventType: 'UPDATE',
        new: { id: 'message-1', role: 'assistant' },
        old: { id: 'message-1', role: 'assistant' },
      }),
    ).toEqual({
      eventType: 'UPDATE',
      new: { id: 'message-1', role: 'assistant' },
      old: { id: 'message-1', role: 'assistant' },
    })
  })

  it('rejects invalid realtime message payloads', () => {
    expect(parseMessageChangePayload(null)).toBeNull()
    expect(parseMessageChangePayload({ eventType: 'BAD' })).toBeNull()
  })
})

describe('parseAssistantStreamBroadcastPayload', () => {
  it('parses snapshot payloads', () => {
    expect(
      parseAssistantStreamBroadcastPayload({
        kind: 'snapshot',
        jobId: 'job-1',
        content: 'partial text',
        regenerateAssistantMessageId: null,
      }),
    ).toEqual({
      kind: 'snapshot',
      jobId: 'job-1',
      content: 'partial text',
      regenerateAssistantMessageId: null,
    })
  })

  it('parses error payloads', () => {
    expect(
      parseAssistantStreamBroadcastPayload({
        kind: 'error',
        jobId: 'job-1',
        error: 'stream failed',
        regenerateAssistantMessageId: 'message-1',
      }),
    ).toEqual({
      kind: 'error',
      jobId: 'job-1',
      error: 'stream failed',
      regenerateAssistantMessageId: 'message-1',
    })
  })

  it('rejects malformed stream payloads', () => {
    expect(parseAssistantStreamBroadcastPayload({ kind: 'snapshot', jobId: 'job-1' })).toBeNull()
    expect(parseAssistantStreamBroadcastPayload('bad')).toBeNull()
  })
})
