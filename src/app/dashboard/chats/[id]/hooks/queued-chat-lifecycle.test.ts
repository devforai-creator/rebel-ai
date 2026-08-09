import { describe, expect, it } from 'vitest'
import type { Message } from '@/types/database.types'
import type { DisplayMessage } from '../utils'
import {
  createInitialQueuedChatLifecycleState,
  isQueuedChatLifecycleLoading,
  queuedChatLifecycleReducer,
  type QueuedChatLifecycleState,
} from './queued-chat-lifecycle'

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'user-1',
    chat_id: 'chat-1',
    user_id: 'account-1',
    role: 'user',
    content: 'hello',
    sequence: 1,
    model_used: null,
    prompt_tokens: null,
    completion_tokens: null,
    latency_ms: null,
    error_code: null,
    debug_info: null,
    content_en: null,
    created_at: '2026-08-10T00:00:00.000Z',
    turn_id: null,
    variant_index: null,
    supersedes_message_id: null,
    message_status: 'completed',
    ...overrides,
  } as Message
}

function createInitialState(initialMessages: Message[] = []): QueuedChatLifecycleState {
  return createInitialQueuedChatLifecycleState({
    initialMessages,
    initialActiveJob: null,
    createdAt: '2026-08-10T00:00:00.000Z',
  })
}

function startMessageSubmission(
  state: QueuedChatLifecycleState,
  overrides: Partial<DisplayMessage> = {},
): QueuedChatLifecycleState {
  return queuedChatLifecycleReducer(state, {
    type: 'MESSAGE_SUBMIT_STARTED',
    optimisticMessage: {
      id: '11111111-1111-4111-8111-111111111111',
      role: 'user',
      content: 'same content',
      created_at: '2026-08-10T00:00:01.000Z',
      temp: true,
      ...overrides,
    },
  })
}

function acceptSubmission(state: QueuedChatLifecycleState): QueuedChatLifecycleState {
  return queuedChatLifecycleReducer(state, {
    type: 'SUBMIT_ACCEPTED',
    jobId: 'job-1',
    deliveryMode: 'streaming',
    userMessageId:
      state.submission.phase === 'submitting' && state.submission.kind === 'message'
        ? state.submission.optimisticMessageId
        : null,
    createdAt: '2026-08-10T00:00:02.000Z',
  })
}

describe('queuedChatLifecycleReducer', () => {
  it('hydrates an active job and its delivery-mode-specific draft from the SSR snapshot', () => {
    const state = createInitialQueuedChatLifecycleState({
      initialMessages: [createMessage()],
      initialActiveJob: {
        id: 'job-restored',
        deliveryMode: 'anthropic_batch',
        regenerateAssistantMessageId: 'assistant-old',
      },
      createdAt: '2026-08-10T00:00:00.000Z',
    })

    expect(state.activeJob).toMatchObject({
      id: 'job-restored',
      phase: 'waiting',
      source: 'initial',
    })
    expect(state.streamingDraft).toMatchObject({
      jobId: 'job-restored',
      deliveryMode: 'anthropic_batch',
      replaceMessageId: 'assistant-old',
    })
    expect(state.streamingDraft?.content).toContain('Claude Batch')
    expect(isQueuedChatLifecycleLoading(state)).toBe(true)
  })

  it('uses one stable ID from optimistic display through submit acknowledgement', () => {
    const submitted = startMessageSubmission(createInitialState())
    const accepted = acceptSubmission(submitted)

    expect(accepted.messages).toHaveLength(1)
    expect(accepted.messages[0].id).toBe('11111111-1111-4111-8111-111111111111')
    expect(accepted.messages[0]).not.toHaveProperty('temp')
    expect(accepted.submission.phase).toBe('idle')
    expect(accepted.activeJob).toMatchObject({
      id: 'job-1',
      phase: 'waiting',
      source: 'submission',
    })
  })

  it('converges when the persisted user row arrives before the submit acknowledgement', () => {
    const submitted = startMessageSubmission(createInitialState())
    const realtimeFirst = queuedChatLifecycleReducer(submitted, {
      type: 'PERSISTED_USER_UPSERTED',
      message: createMessage({
        id: '11111111-1111-4111-8111-111111111111',
        content: 'same content',
        sequence: 2,
      }),
    })
    const accepted = acceptSubmission(realtimeFirst)

    expect(accepted.messages).toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        sequence: 2,
      }),
    ])
    expect(accepted.messages[0]).not.toHaveProperty('temp')
  })

  it('preserves insertion order when an assistant reply arrives before the user sequence', () => {
    const initialMessages = [
      createMessage({ id: 'user-1', sequence: 1 }),
      createMessage({
        id: 'assistant-1',
        role: 'assistant',
        content: 'first reply',
        sequence: 2,
      }),
    ]
    const accepted = acceptSubmission(
      startMessageSubmission(createInitialState(initialMessages), { sequence: null }),
    )
    const withAssistantReply = queuedChatLifecycleReducer(accepted, {
      type: 'PERSISTED_ASSISTANT_UPSERTED',
      message: createMessage({
        id: 'assistant-2',
        role: 'assistant',
        content: 'second reply',
        sequence: 4,
      }),
    })

    expect(withAssistantReply.messages.map((message) => message.id)).toEqual([
      'user-1',
      'assistant-1',
      '11111111-1111-4111-8111-111111111111',
      'assistant-2',
    ])
  })

  it('does not reconcile a different persisted message merely because its content matches', () => {
    const submitted = startMessageSubmission(createInitialState())
    const withRemoteMessage = queuedChatLifecycleReducer(submitted, {
      type: 'PERSISTED_USER_UPSERTED',
      message: createMessage({ id: 'remote-user', content: 'same content', sequence: 2 }),
    })

    expect(withRemoteMessage.messages).toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        temp: true,
      }),
      expect.objectContaining({ id: 'remote-user' }),
    ])
  })

  it('removes only the exact optimistic message when submission fails', () => {
    const submitted = startMessageSubmission(
      createInitialState([createMessage({ id: 'persisted-user', content: 'same content' })]),
    )
    const failed = queuedChatLifecycleReducer(submitted, {
      type: 'SUBMIT_FAILED',
      error: new Error('request failed'),
    })

    expect(failed.messages.map((message) => message.id)).toEqual(['persisted-user'])
    expect(failed.error?.message).toBe('request failed')
    expect(isQueuedChatLifecycleLoading(failed)).toBe(false)
  })

  it('preserves an exact persisted row when the POST response is lost after commit', () => {
    const submitted = startMessageSubmission(createInitialState())
    const persisted = queuedChatLifecycleReducer(submitted, {
      type: 'PERSISTED_USER_UPSERTED',
      message: createMessage({
        id: '11111111-1111-4111-8111-111111111111',
        content: 'same content',
        sequence: 2,
      }),
    })
    const responseLost = queuedChatLifecycleReducer(persisted, {
      type: 'SUBMIT_FAILED',
      error: new Error('network response lost'),
    })

    expect(responseLost.messages).toEqual([
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        sequence: 2,
      }),
    ])
    expect(responseLost.messages[0]).not.toHaveProperty('temp')
  })

  it('keeps the current draft for an old assistant update and seals it for a new reply', () => {
    const oldAssistant = createMessage({
      id: 'assistant-old',
      role: 'assistant',
      content: 'old reply',
      sequence: 2,
    })
    let state = acceptSubmission(startMessageSubmission(createInitialState([oldAssistant])))
    state = queuedChatLifecycleReducer(state, {
      type: 'STREAM_EVENT_RECEIVED',
      payload: {
        kind: 'snapshot',
        jobId: 'job-1',
        content: 'partial reply',
        regenerateAssistantMessageId: null,
      },
      receivedAt: '2026-08-10T00:00:03.000Z',
    })

    const afterOldUpdate = queuedChatLifecycleReducer(state, {
      type: 'PERSISTED_ASSISTANT_UPSERTED',
      message: {
        id: 'assistant-old',
        role: 'assistant',
        message_status: 'completed',
      },
    })
    expect(afterOldUpdate.streamingDraft?.content).toBe('partial reply')

    const afterNewReply = queuedChatLifecycleReducer(afterOldUpdate, {
      type: 'PERSISTED_ASSISTANT_UPSERTED',
      message: createMessage({
        id: 'assistant-new',
        role: 'assistant',
        content: 'final reply',
        sequence: 3,
      }),
    })
    expect(afterNewReply.streamingDraft).toBeNull()
    expect(afterNewReply.activeJob?.phase).toBe('message-received')

    const afterLateSnapshot = queuedChatLifecycleReducer(afterNewReply, {
      type: 'STREAM_EVENT_RECEIVED',
      payload: {
        kind: 'snapshot',
        jobId: 'job-1',
        content: 'stale partial reply',
        regenerateAssistantMessageId: null,
      },
      receivedAt: '2026-08-10T00:00:04.000Z',
    })
    expect(afterLateSnapshot).toEqual(afterNewReply)
  })

  it('ignores events for another or already-terminal job', () => {
    const active = acceptSubmission(startMessageSubmission(createInitialState()))
    const wrongJob = queuedChatLifecycleReducer(active, {
      type: 'STREAM_EVENT_RECEIVED',
      payload: {
        kind: 'snapshot',
        jobId: 'job-stale',
        content: 'wrong job',
        regenerateAssistantMessageId: null,
      },
      receivedAt: '2026-08-10T00:00:03.000Z',
    })
    expect(wrongJob).toEqual(active)

    const completed = queuedChatLifecycleReducer(active, {
      type: 'JOB_SUCCEEDED',
      jobId: 'job-1',
    })
    const lateStream = queuedChatLifecycleReducer(completed, {
      type: 'STREAM_EVENT_RECEIVED',
      payload: {
        kind: 'snapshot',
        jobId: 'job-1',
        content: 'too late',
        regenerateAssistantMessageId: null,
      },
      receivedAt: '2026-08-10T00:00:04.000Z',
    })

    expect(lateStream).toEqual(completed)
    expect(isQueuedChatLifecycleLoading(lateStream)).toBe(false)
  })

  it('preserves the acknowledged user message when the generation job fails', () => {
    const accepted = acceptSubmission(startMessageSubmission(createInitialState()))
    const failed = queuedChatLifecycleReducer(accepted, {
      type: 'JOB_FAILED',
      jobId: 'job-1',
      error: new Error('generation failed'),
    })

    expect(failed.messages).toEqual([
      expect.objectContaining({ id: '11111111-1111-4111-8111-111111111111' }),
    ])
    expect(failed.activeJob).toBeNull()
    expect(failed.streamingDraft).toBeNull()
    expect(failed.error?.message).toBe('generation failed')
  })

  it('reconciles regeneration to the new assistant identity', () => {
    const user = createMessage({ id: 'user-1', sequence: 1 })
    const oldAssistant = createMessage({
      id: 'assistant-old',
      role: 'assistant',
      content: 'old reply',
      sequence: 2,
    })
    let state = createInitialState([user, oldAssistant])
    state = queuedChatLifecycleReducer(state, {
      type: 'REGENERATION_SUBMIT_STARTED',
      regenerateAssistantMessageId: 'assistant-old',
    })
    state = queuedChatLifecycleReducer(state, {
      type: 'SUBMIT_ACCEPTED',
      jobId: 'job-regen',
      deliveryMode: 'streaming',
      userMessageId: null,
      createdAt: '2026-08-10T00:00:02.000Z',
    })
    state = queuedChatLifecycleReducer(state, {
      type: 'PERSISTED_ASSISTANT_UPSERTED',
      message: createMessage({
        id: 'assistant-new',
        role: 'assistant',
        content: 'new reply',
        sequence: 3,
        supersedes_message_id: 'assistant-old',
      }),
    })

    expect(state.messages.map((message) => message.id)).toEqual(['user-1', 'assistant-new'])
    expect(state.streamingDraft).toBeNull()
  })

  it('applies rollback deletes by exact persisted identity', () => {
    const state = createInitialState([
      createMessage({ id: 'user-1' }),
      createMessage({ id: 'user-2', content: 'same content', sequence: 2 }),
    ])
    const rolledBack = queuedChatLifecycleReducer(state, {
      type: 'MESSAGE_DELETED',
      messageId: 'user-2',
    })

    expect(rolledBack.messages.map((message) => message.id)).toEqual(['user-1'])
  })
})
