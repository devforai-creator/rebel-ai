import { describe, expect, it } from 'vitest'
import {
  CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
  CHAT_DELIVERY_MODE_STREAMING,
} from '@/lib/chat/delivery-mode'
import {
  BATCH_JOB_POLLER_CONFIG,
  createStreamingAssistantDraft,
  getQueuedChatPollerConfig,
  getQueuedChatSlowProgressMessage,
  resolveQueuedChatPollSleepDelay,
  updateStreamingDraftFromEvent,
} from './queued-chat-runtime'
import { DEFAULT_JOB_POLLER_CONFIG } from './job-poller'

describe('queued-chat-runtime', () => {
  it('creates a blank streaming draft for streaming mode', () => {
    const draft = createStreamingAssistantDraft('job-1', null, CHAT_DELIVERY_MODE_STREAMING)

    expect(draft).toMatchObject({
      id: 'stream-job-1',
      jobId: 'job-1',
      content: '',
      replaceMessageId: null,
      deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
    })
  })

  it('creates the batch placeholder draft for anthropic batch mode', () => {
    const draft = createStreamingAssistantDraft(
      'job-1',
      'assistant-1',
      CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
    )

    expect(draft.content).toContain('Claude Batch')
    expect(draft.replaceMessageId).toBe('assistant-1')
  })

  it('updates an existing draft from snapshot events', () => {
    const current = createStreamingAssistantDraft('job-1', null, CHAT_DELIVERY_MODE_STREAMING)
    const next = updateStreamingDraftFromEvent(current, {
      kind: 'snapshot',
      jobId: 'job-1',
      content: 'partial response',
      regenerateAssistantMessageId: 'assistant-2',
    })

    expect(next).toMatchObject({
      jobId: 'job-1',
      content: 'partial response',
      replaceMessageId: 'assistant-2',
      deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
    })
  })

  it('creates a replacement draft when the current draft is missing', () => {
    const next = updateStreamingDraftFromEvent(null, {
      kind: 'snapshot',
      jobId: 'job-1',
      content: 'partial response',
      regenerateAssistantMessageId: null,
    })

    expect(next).toMatchObject({
      id: 'stream-job-1',
      content: 'partial response',
      replaceMessageId: null,
    })
  })

  it('returns delivery-mode-specific slow-progress messages', () => {
    expect(getQueuedChatSlowProgressMessage(CHAT_DELIVERY_MODE_STREAMING, 12_000)).toContain('12s')
    expect(getQueuedChatSlowProgressMessage(CHAT_DELIVERY_MODE_ANTHROPIC_BATCH, 12_000)).toContain(
      'Claude Batch',
    )
  })

  it('returns the correct poller config per delivery mode', () => {
    expect(getQueuedChatPollerConfig(CHAT_DELIVERY_MODE_STREAMING)).toBe(DEFAULT_JOB_POLLER_CONFIG)
    expect(getQueuedChatPollerConfig(CHAT_DELIVERY_MODE_ANTHROPIC_BATCH)).toBe(
      BATCH_JOB_POLLER_CONFIG,
    )
  })

  it('keeps batch sleep delays unchanged and adapts streaming delays', () => {
    const batchDelay = resolveQueuedChatPollSleepDelay({
      baseDelayMs: 500,
      deliveryMode: CHAT_DELIVERY_MODE_ANTHROPIC_BATCH,
      isPageVisible: false,
      lastProgressAt: Date.now(),
      now: Date.now(),
    })
    const streamingDelay = resolveQueuedChatPollSleepDelay({
      baseDelayMs: 500,
      deliveryMode: CHAT_DELIVERY_MODE_STREAMING,
      isPageVisible: false,
      lastProgressAt: null,
      now: Date.now(),
    })

    expect(batchDelay).toBe(500)
    expect(streamingDelay).toBeGreaterThanOrEqual(500)
  })
})
